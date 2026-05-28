require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const db = require('./db');

// Initialize Resend for sending emails
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Initialize Supabase client for admin operations (optional - only used for account deletion)
let supabase = null;
if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );
}

const app = express();
const server = http.createServer(app);

const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F0B27A', '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
];

const ADMIN_EMAIL = 'l.j.hooper@lancaster.ac.uk';

const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢'];
const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'];

// In-memory rate limit state: 5 messages / 10s, cooldown 10s
const rateLimitState = new Map();

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5174',
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5174' }));
app.use(express.json());

// Decode Supabase JWT (we trust the token since it comes from Supabase)
function decodeSupabaseToken(token) {
  try {
    // If we have the JWT secret, verify properly
    if (process.env.SUPABASE_JWT_SECRET && process.env.SUPABASE_JWT_SECRET !== 'your-supabase-jwt-secret') {
      try {
        return jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
      } catch (verifyErr) {
        console.error('[JWT] Verify failed:', verifyErr.message);
        // Decode the header to check the algorithm
        const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
        console.error('[JWT] Token algorithm:', header.alg, '| kid:', header.kid);
        console.error('[JWT] Secret starts with:', process.env.SUPABASE_JWT_SECRET.substring(0, 10) + '...');
        // Fallback: if verify fails, decode without verification
        const decoded = jwt.decode(token);
        if (decoded && decoded.sub) {
          console.log('[JWT] Falling back to decode-only (token alg may not match secret)');
          return decoded;
        }
        return null;
      }
    }
    // Otherwise decode without verification (dev mode)
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.sub) throw new Error('Invalid token');
    return decoded;
  } catch (err) {
    console.error('[JWT] decodeSupabaseToken error:', err.message);
    return null;
  }
}

// Ensure user exists in our local DB (sync from Supabase)
function ensureLocalUser(supabaseUserId, email, displayName, avatarColor, avatarUrl) {
  let user = db.prepare('SELECT id, email, display_name, avatar_color, avatar_url, is_admin, is_banned, has_seen_intro FROM users WHERE id = ?').get(supabaseUserId);
  if (!user) {
    console.log('[ensureLocalUser] Creating new user:', supabaseUserId);
    const name = displayName || 'Anonymous';
    const color = avatarColor || AVATAR_COLORS[supabaseUserId.charCodeAt(0) % AVATAR_COLORS.length];
    const safeEmail = (email || '').toLowerCase() || `${supabaseUserId}@unknown.local`;
    const isAdmin = safeEmail === ADMIN_EMAIL ? 1 : 0;
    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, avatar_color, avatar_url, is_verified, is_admin)
      VALUES (?, ?, '', ?, ?, ?, 1, ?)
    `).run(supabaseUserId, safeEmail, name, color, avatarUrl || null, isAdmin);
    user = { id: supabaseUserId, email: safeEmail, display_name: name, avatar_color: color, avatar_url: avatarUrl || null, is_admin: isAdmin, is_banned: 0, has_seen_intro: 0 };
  } else {
    console.log('[ensureLocalUser] Existing user found:', { current: user.display_name, new: displayName });
    // Don't overwrite display_name from Supabase - local DB is source of truth
    // (Users update their display name via /api/me/profile which updates local DB only)
    if (avatarColor && avatarColor !== user.avatar_color) {
      console.log('[ensureLocalUser] Updating avatar_color');
      db.prepare('UPDATE users SET avatar_color = ? WHERE id = ?').run(avatarColor, supabaseUserId);
      user.avatar_color = avatarColor;
    }
    if (avatarUrl !== undefined && avatarUrl !== user.avatar_url) {
      console.log('[ensureLocalUser] Updating avatar_url');
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, supabaseUserId);
      user.avatar_url = avatarUrl;
    }
    const safeEmail = (email || '').toLowerCase();
    // Only update email if DB has a placeholder email (noemail.lancschat.lol)
    // Once a user adds a real email, the DB is the source of truth, not the JWT
    if (safeEmail && user.email !== safeEmail && user.email.includes('@noemail.lancschat.lol')) {
      console.log('[ensureLocalUser] Updating email from placeholder to:', safeEmail);
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(safeEmail, supabaseUserId);
      user.email = safeEmail;
    }
    if (user.email && user.email.toLowerCase() === ADMIN_EMAIL && !user.is_admin) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(supabaseUserId);
      user.is_admin = 1;
    }
  }
  return user;
}

function getReactionSummary(messageIds, viewerUserId) {
  if (!messageIds.length) return new Map();

  const placeholders = messageIds.map(() => '?').join(',');
  const counts = db.prepare(
    `SELECT message_id, emoji, COUNT(*) as count
     FROM message_reactions
     WHERE message_id IN (${placeholders})
     GROUP BY message_id, emoji`
  ).all(...messageIds);

  const mine = db.prepare(
    `SELECT message_id, emoji
     FROM message_reactions
     WHERE message_id IN (${placeholders}) AND user_id = ?`
  ).all(...messageIds, viewerUserId);

  const mineSet = new Set(mine.map((r) => `${r.message_id}::${r.emoji}`));
  const map = new Map();

  for (const row of counts) {
    if (!map.has(row.message_id)) map.set(row.message_id, []);
    map.get(row.message_id).push({
      emoji: row.emoji,
      count: row.count,
      reactedByMe: mineSet.has(`${row.message_id}::${row.emoji}`),
    });
  }

  return map;
}

function attachRepliesAndReactions(messages, viewerUserId) {
  const messageIds = messages.map((m) => m.id);
  const reactionsMap = getReactionSummary(messageIds, viewerUserId);

  const replyIds = Array.from(
    new Set(messages.map((m) => m.reply_to_message_id).filter(Boolean))
  );
  let replyMap = new Map();
  if (replyIds.length) {
    const placeholders = replyIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT m.id, m.content, m.is_deleted, m.sender_id, u.display_name
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.id IN (${placeholders})`
    ).all(...replyIds);

    replyMap = new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          sender_id: r.sender_id,
          display_name: r.display_name,
          content: r.is_deleted ? '' : r.content,
          is_deleted: !!r.is_deleted,
        },
      ])
    );
  }

  return messages.map((m) => ({
    ...m,
    content: m.is_deleted ? '' : m.content,
    reactions: reactionsMap.get(m.id) || [],
    reply_to: m.reply_to_message_id ? (replyMap.get(m.reply_to_message_id) || null) : null,
  }));
}

function canSendMessage(userId, isVerified = true) {
  const now = Math.floor(Date.now() / 1000);
  const state = rateLimitState.get(userId) || { timestamps: [], cooldownUntil: 0 };
  if (state.cooldownUntil && now < state.cooldownUntil) {
    return { ok: false, retryAfter: state.cooldownUntil - now };
  }

  if (!isVerified) {
    // Unverified users: 1 message per 30 seconds
    state.timestamps = state.timestamps.filter((t) => now - t < 30);
    if (state.timestamps.length >= 1) {
      state.cooldownUntil = now + 30;
      state.timestamps = [];
      rateLimitState.set(userId, state);
      return { ok: false, retryAfter: 30 };
    }
  } else {
    // Verified users: 5 messages per 10 seconds
    state.timestamps = state.timestamps.filter((t) => now - t < 10);
    if (state.timestamps.length >= 5) {
      state.cooldownUntil = now + 10;
      state.timestamps = [];
      rateLimitState.set(userId, state);
      return { ok: false, retryAfter: 10 };
    }
  }

  state.timestamps.push(now);
  rateLimitState.set(userId, state);
  return { ok: true };
}

// Auth middleware for REST endpoints
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });

  const token = authHeader.split(' ')[1];
  const decoded = decodeSupabaseToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });

  req.userId = decoded.sub;
  req.userMeta = decoded.user_metadata || {};
  req.decoded = decoded;
  next();
}

function requireAdmin(req, res, next) {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.userId);
  if (!row || !row.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

// Get all rooms
app.get('/api/rooms', (req, res) => {
  const authHeader = req.headers.authorization;
  let userId = null;
  
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    const decoded = decodeSupabaseToken(token);
    if (decoded) userId = decoded.sub;
  }

  const rooms = db.prepare(`
    SELECT * FROM rooms
    ORDER BY
      CASE WHEN is_default = 1 THEN 0 ELSE 1 END,
      sort_order ASC,
      name ASC
  `).all();

  if (!userId) {
    return res.json(rooms);
  }

  // Get last message and unread status for each room
  const enriched = rooms.map((room) => {
    const lastMsg = db.prepare(`
      SELECT m.content, m.created_at, m.sender_id, u.display_name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.room_id = ? AND m.message_type = 'room' AND m.is_deleted = 0
      ORDER BY m.created_at DESC
      LIMIT 1
    `).get(room.id);

    const lastRead = db.prepare('SELECT last_read_at FROM room_last_read WHERE user_id = ? AND room_id = ?').get(userId, room.id);
    const lastReadAt = lastRead ? lastRead.last_read_at : 0;
    const hasUnread = lastMsg && lastMsg.created_at > lastReadAt && lastMsg.sender_id !== userId;

    if (lastMsg) {
      console.log(`[/api/rooms] ${room.name}: lastMsg.created_at=${lastMsg.created_at}, lastReadAt=${lastReadAt}, sender=${lastMsg.sender_id}, currentUser=${userId}, hasUnread=${hasUnread}`);
    }

    return {
      ...room,
      last_message: lastMsg ? lastMsg.content : null,
      last_message_at: lastMsg ? lastMsg.created_at : null,
      last_message_sender: lastMsg ? lastMsg.display_name : null,
      has_unread: hasUnread,
    };
  });

  res.json(enriched);
});

// Get current user server-side flags
app.get('/api/me', authMiddleware, async (req, res) => {
  const meta = req.userMeta || {};
  const email = (req.decoded && req.decoded.email) || meta.email || '';

  let emailConfirmed = false;

  if (supabase) {
    try {
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(req.userId);
      if (userError || !userData?.user) {
        console.warn('[/api/me] Supabase user not found (deleted or invalid):', req.userId, userError?.message);
        return res.status(401).json({ error: 'Account no longer exists', code: 'ACCOUNT_DELETED' });
      }

      const supaEmail = userData.user.email || email;
      const isNoEmail = supaEmail.includes('@noemail.lancschat.lol');
      emailConfirmed = isNoEmail || !!userData.user.email_confirmed_at;
    } catch (err) {
      console.error('[/api/me] Error checking Supabase user:', err.message);
      return res.status(503).json({ error: 'Could not verify account status' });
    }
  }

  const u = ensureLocalUser(req.userId, email, meta.display_name, meta.avatar_color, meta.avatar_url);
  const full = db.prepare('SELECT id, email, display_name, avatar_color, avatar_url, is_admin, is_banned, banned_reason, has_seen_intro, created_at, last_seen FROM users WHERE id = ?').get(u.id);

  res.json({
    id: full.id,
    email: full.email,
    displayName: full.display_name,
    avatarColor: full.avatar_color,
    avatarUrl: full.avatar_url,
    isAdmin: !!full.is_admin,
    isBanned: !!full.is_banned,
    bannedReason: full.banned_reason || null,
    hasSeenIntro: !!full.has_seen_intro,
    emailConfirmed,
    createdAt: full.created_at,
    lastSeen: full.last_seen,
  });
});

app.post('/api/me/intro-seen', authMiddleware, (req, res) => {
  db.prepare('UPDATE users SET has_seen_intro = 1 WHERE id = ?').run(req.userId);
  res.json({ ok: true });
});

// Update user profile (display name)
app.put('/api/me/profile', authMiddleware, async (req, res) => {
  const { displayName } = req.body;
  
  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return res.status(400).json({ error: 'Display name is required' });
  }
  
  const trimmedName = displayName.trim();
  if (trimmedName.length > 50) {
    return res.status(400).json({ error: 'Display name must be 50 characters or less' });
  }
  
  try {
    console.log('[PUT /api/me/profile] Updating display name for user:', req.userId, 'to:', trimmedName);
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(trimmedName, req.userId);
    
    const updated = db.prepare('SELECT id, email, display_name, avatar_color, avatar_url, is_admin FROM users WHERE id = ?').get(req.userId);
    console.log('[PUT /api/me/profile] Updated user:', updated);
    
    res.json({
      displayName: updated.display_name,
      avatarColor: updated.avatar_color,
      avatarUrl: updated.avatar_url,
    });
  } catch (err) {
    console.error('[PUT /api/me/profile] Error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update user email (for no-email users adding an email)
app.post('/api/me/update-email', authMiddleware, async (req, res) => {
  const { email } = req.body;
  console.log('[update-email] Request received:', { userId: req.userId, email, hasSupabase: !!supabase });
  
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    console.error('[update-email] Invalid email format:', email);
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    const newEmail = email.toLowerCase().trim();
    console.log('[update-email] Processing email update for user:', req.userId, 'to:', newEmail);

    if (!resend) {
      console.error('[update-email] Resend not initialized! Check RESEND_API_KEY env var');
      return res.status(500).json({ error: 'Email service not configured' });
    }

    // Generate a simple confirmation token
    const crypto = require('crypto');
    const confirmToken = crypto.randomBytes(32).toString('hex');
    const serverUrl = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3001';
    const confirmUrl = `${serverUrl}/api/confirm-email?token=${confirmToken}&userId=${req.userId}`;
    
    console.log('[update-email] Generated confirmation URL');
    
    // Store the pending email change in local DB with token
    console.log('[update-email] Storing pending email change...');
    db.prepare(`
      INSERT OR REPLACE INTO pending_email_changes (user_id, new_email, token, created_at)
      VALUES (?, ?, ?, ?)
    `).run(req.userId, newEmail, confirmToken, Date.now());
    
    // Send confirmation email via Resend
    console.log('[update-email] Sending confirmation email via Resend...');
    
    const fs = require('fs');
    const path = require('path');
    const templatePath = path.join(__dirname, 'email-templates', 'signup-confirmation.html');
    let emailHtml = fs.readFileSync(templatePath, 'utf8');
    emailHtml = emailHtml.replace('{{ .ConfirmationURL }}', confirmUrl);
    
    try {
      const { data: emailData, error: emailError } = await resend.emails.send({
        from: 'LancsChat <noreply@lancschat.lol>',
        to: [newEmail],
        subject: 'Confirm your LancsChat email',
        html: emailHtml,
      });
      
      if (emailError) {
        console.error('[update-email] Resend error:', emailError);
        return res.status(500).json({ error: 'Failed to send confirmation email' });
      }
      
      console.log('[update-email] ✅ Confirmation email sent via Resend. Email ID:', emailData?.id);
    } catch (emailErr) {
      console.error('[update-email] Error sending email:', emailErr);
      return res.status(500).json({ error: 'Failed to send confirmation email' });
    }
    
    console.log('[update-email] ✅ Email update initiated. Confirmation email sent to:', newEmail);

    res.json({ ok: true, email: newEmail, emailConfirmed: false });
  } catch (err) {
    console.error('[update-email] Unexpected error:', err);
    console.error('[update-email] Error stack:', err instanceof Error ? err.stack : 'No stack trace');
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update email' });
  }
});

// Confirm email change
app.get('/api/confirm-email', async (req, res) => {
  const { token, userId } = req.query;
  
  if (!token || !userId) {
    return res.status(400).json({ error: 'Missing token or userId' });
  }
  
  try {
    console.log('[confirm-email] Confirming email for user:', userId);
    
    // Find the pending email change
    const pending = db.prepare('SELECT * FROM pending_email_changes WHERE user_id = ? AND token = ?').get(userId, token);
    
    if (!pending) {
      console.error('[confirm-email] Invalid or expired token');
      return res.status(400).json({ error: 'Invalid or expired confirmation link' });
    }
    
    // Check if token is older than 24 hours
    const tokenAge = Date.now() - pending.created_at;
    if (tokenAge > 24 * 60 * 60 * 1000) {
      console.error('[confirm-email] Token expired');
      db.prepare('DELETE FROM pending_email_changes WHERE user_id = ?').run(userId);
      return res.status(400).json({ error: 'Confirmation link has expired' });
    }
    
    // Update the user's email in local DB
    console.log('[confirm-email] Updating email to:', pending.new_email);
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(pending.new_email, userId);
    
    // Update in Supabase if available
    if (supabase) {
      try {
        await supabase.auth.admin.updateUserById(userId, {
          email: pending.new_email,
          email_confirm: true,
        });
        console.log('[confirm-email] Email updated in Supabase');
      } catch (err) {
        console.error('[confirm-email] Failed to update Supabase (non-critical):', err);
      }
    }
    
    // Delete the pending change
    db.prepare('DELETE FROM pending_email_changes WHERE user_id = ?').run(userId);
    
    console.log('[confirm-email] ✅ Email confirmed successfully');
    
    // Redirect to the app
    res.redirect(process.env.CLIENT_URL || 'http://localhost:5174');
  } catch (err) {
    console.error('[confirm-email] Error:', err);
    res.status(500).json({ error: 'Failed to confirm email' });
  }
});

// Delete user account
app.delete('/api/me/account', authMiddleware, async (req, res) => {
  const user = db.prepare('SELECT email, is_admin FROM users WHERE id = ?').get(req.userId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  try {
    console.log('[DELETE /api/me/account] Deleting account for user:', req.userId);
    
    // Helper to safely delete from table if it exists
    const safeDelete = (query, ...params) => {
      try {
        db.prepare(query).run(...params);
      } catch (err) {
        // Table might not exist in older databases - that's ok
        console.log('[DELETE /api/me/account] Skipping:', query, err.message);
      }
    };
    
    // Delete in order to respect foreign key constraints
    
    // 1. Delete user's reactions (if table exists)
    safeDelete('DELETE FROM reactions WHERE user_id = ?', req.userId);
    
    // 2. Delete user's reports (if table exists)
    safeDelete('DELETE FROM message_reports WHERE reporter_id = ?', req.userId);
    
    // 3. Delete user's pinned messages (if table exists)
    safeDelete('DELETE FROM pinned_messages WHERE pinned_by = ?', req.userId);
    
    // 4. Delete user's unban requests (if table exists)
    safeDelete('DELETE FROM unban_requests WHERE user_id = ?', req.userId);
    
    // 5. Delete DM conversations
    safeDelete('DELETE FROM dm_conversations WHERE user1_id = ? OR user2_id = ?', req.userId, req.userId);
    
    // 6. Delete all messages sent by user (hard delete to avoid foreign key issues)
    safeDelete('DELETE FROM messages WHERE sender_id = ?', req.userId);
    
    // 7. Finally, delete the user
    db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
    
    // Delete from Supabase (if client is available)
    if (supabase) {
      console.log('[DELETE /api/me/account] Attempting Supabase deletion...');
      const { data, error: supabaseError } = await supabase.auth.admin.deleteUser(req.userId);
      if (supabaseError) {
        console.error('[DELETE /api/me/account] Supabase deletion failed:', supabaseError.message, supabaseError.status);
        // Continue anyway - local DB deletion succeeded
      } else {
        console.log('[DELETE /api/me/account] Supabase deletion successful');
      }
    } else {
      console.log('[DELETE /api/me/account] Supabase client not available, skipping Supabase deletion');
    }
    
    console.log('[DELETE /api/me/account] Account deleted successfully from local DB');
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/me/account] Error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Auto-confirm a user (for no-email signups)
app.post('/api/auth/confirm-user', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!supabase) return res.status(500).json({ error: 'Supabase admin client not available' });

  try {
    console.log('[confirm-user] Confirming user:', userId);
    const { data, error } = await supabase.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });
    if (error) {
      console.error('[confirm-user] Error:', error);
      return res.status(500).json({ error: error.message });
    }
    console.log('[confirm-user] Success:', data.user?.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[confirm-user] Exception:', err);
    res.status(500).json({ error: 'Failed to confirm user' });
  }
});

// Get email by username for login
app.get('/api/email-by-username', (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }
  const user = db.prepare('SELECT email FROM users WHERE display_name = ? COLLATE NOCASE').get(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ email: user.email });
});

// Search users by display name (for starting new DMs)
app.get('/api/users/search', authMiddleware, (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    return res.json([]);
  }
  const query = `%${q.trim()}%`;
  const users = db.prepare(`
    SELECT id, display_name, avatar_color
    FROM users
    WHERE display_name LIKE ? COLLATE NOCASE
      AND id != ?
      AND is_banned = 0
    LIMIT 20
  `).all(query, req.userId);
  res.json(users.map(u => ({ id: u.id, displayName: u.display_name, avatarColor: u.avatar_color })));
});

// Submit unban request
app.post('/api/unban-request', authMiddleware, (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message required' });
  }
  
  const u = ensureLocalUser(req.userId, req.decoded.email, req.userMeta.display_name, req.userMeta.avatar_color, req.userMeta.avatar_url);
  if (!u.is_banned) {
    return res.status(400).json({ error: 'User is not banned' });
  }

  db.prepare(`
    INSERT INTO unban_requests (user_id, display_name, message, created_at)
    VALUES (?, ?, ?, unixepoch())
  `).run(req.userId, u.display_name, message.trim());

  res.json({ ok: true });
});

// Get messages for a room
app.get('/api/rooms/:roomId/messages', authMiddleware, (req, res) => {
  const { roomId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const before = req.query.before;

  let query = `
    SELECT m.id, m.content, m.created_at, m.sender_id,
           m.reply_to_message_id, m.is_deleted,
           u.display_name, u.avatar_color, u.avatar_url, u.is_admin
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.room_id = ? AND m.message_type = 'room'
  `;
  const params = [roomId];

  if (before) {
    query += ' AND m.created_at < ?';
    params.push(parseInt(before));
  }

  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  const messages = db.prepare(query).all(...params);
  const enriched = attachRepliesAndReactions(messages.reverse(), req.userId);
  res.json(enriched);
});

// Get pinned messages for a room
app.get('/api/rooms/:roomId/pinned', authMiddleware, (req, res) => {
  const { roomId } = req.params;
  try {
    const pins = db.prepare(`
      SELECT p.id, p.message_id, p.pinned_at, p.pinned_by,
             m.content, m.created_at, m.sender_id,
             u.display_name, u.avatar_color, u.avatar_url, u.is_admin
      FROM pinned_messages p
      JOIN messages m ON p.message_id = m.id
      JOIN users u ON m.sender_id = u.id
      WHERE p.room_id = ?
      ORDER BY p.pinned_at DESC
    `).all(roomId);

    res.json(pins.map(p => ({
      id: p.id,
      message_id: p.message_id,
      content: p.content,
      created_at: p.created_at,
      sender_id: p.sender_id,
      display_name: p.display_name,
      avatar_color: p.avatar_color,
      avatar_url: p.avatar_url,
      is_admin: !!p.is_admin,
      pinned_at: p.pinned_at,
      pinned_by: p.pinned_by,
    })));
  } catch (err) {
    console.error('Pinned messages error:', err);
    res.json([]);
  }
});

// Get DM conversations for a user
app.get('/api/dms', authMiddleware, (req, res) => {
  try {
    const userId = req.userId;
    console.log('[/api/dms] Request from user:', userId);

    const conversations = db.prepare(`
      SELECT 
        dc.id,
        dc.user1_id,
        dc.user2_id,
        dc.last_message,
        dc.last_message_at,
        dc.last_message_sender,
        dc.user1_last_read,
        dc.user2_last_read,
        CASE WHEN dc.user1_id = ? THEN dc.user2_id ELSE dc.user1_id END as other_id,
        CASE WHEN dc.user1_id = ? THEN u2.display_name ELSE u1.display_name END as other_name,
        CASE WHEN dc.user1_id = ? THEN u2.avatar_color ELSE u1.avatar_color END as other_color,
        CASE WHEN dc.user1_id = ? THEN u2.avatar_url ELSE u1.avatar_url END as other_avatar_url
      FROM dm_conversations dc
      JOIN users u1 ON dc.user1_id = u1.id
      JOIN users u2 ON dc.user2_id = u2.id
      WHERE dc.user1_id = ? OR dc.user2_id = ?
      ORDER BY dc.last_message_at DESC NULLS LAST, dc.created_at DESC
    `).all(userId, userId, userId, userId, userId, userId);
    
    console.log('[/api/dms] Found', conversations.length, 'conversations');

    const result = conversations.map((c) => {
      const isUser1 = c.user1_id === userId;
      const lastRead = isUser1 ? (c.user1_last_read || 0) : (c.user2_last_read || 0);
      const hasUnread = c.last_message_at && c.last_message_at > lastRead && c.last_message_sender !== userId;
      
      return {
        id: c.id,
        other_id: c.other_id,
        other_name: c.other_name,
        other_color: c.other_color,
        other_avatar_url: c.other_avatar_url,
        last_message: c.last_message,
        last_message_at: c.last_message_at,
        last_message_sender: c.last_message_sender,
        has_unread: hasUnread,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('DMs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark DM conversation as read
app.post('/api/dms/:conversationId/read', authMiddleware, (req, res) => {
  try {
    const userId = req.userId;
    const { conversationId } = req.params;
    
    const convo = db.prepare('SELECT user1_id, user2_id FROM dm_conversations WHERE id = ?').get(conversationId);
    if (!convo) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    const isUser1 = convo.user1_id === userId;
    const isUser2 = convo.user2_id === userId;
    
    if (!isUser1 && !isUser2) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const now = Math.floor(Date.now() / 1000);
    const column = isUser1 ? 'user1_last_read' : 'user2_last_read';
    
    db.prepare(`UPDATE dm_conversations SET ${column} = ? WHERE id = ?`).run(now, conversationId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark DM read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete DM conversation
app.delete('/api/dms/:conversationId', authMiddleware, (req, res) => {
  try {
    const userId = req.userId;
    const { conversationId } = req.params;
    
    const convo = db.prepare('SELECT * FROM dm_conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)').get(conversationId, userId, userId);
    if (!convo) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    db.prepare('DELETE FROM dm_conversations WHERE id = ?').run(conversationId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete DM error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get DM messages
app.get('/api/dms/:otherUserId/messages', authMiddleware, (req, res) => {
  try {
    const { otherUserId } = req.params;
    const userId = req.userId;

    const rows = db.prepare(`
      SELECT m.id, m.content, m.created_at, m.sender_id, m.reply_to_message_id, m.is_deleted,
             u.display_name, u.avatar_color, u.avatar_url, u.is_admin
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.message_type = 'dm'
        AND ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
      ORDER BY m.created_at ASC
    `).all(userId, otherUserId, otherUserId, userId);

    const enriched = attachRepliesAndReactions(rows.reverse(), userId);
    res.json(enriched);
  } catch (err) {
    console.error('DM messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin APIs
app.get('/api/admin/stats', authMiddleware, requireAdmin, (req, res) => {
  const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const roomCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get();
  const dmCount = db.prepare('SELECT COUNT(*) as count FROM dm_conversations').get();
  
  let dbSizeMB = 0;
  try {
    const fs = require('fs');
    const dbPath = require('path').join(__dirname, 'lancschat.db');
    if (fs.existsSync(dbPath)) {
      dbSizeMB = fs.statSync(dbPath).size / (1024 * 1024);
    }
  } catch (err) {
    console.error('Failed to get DB size:', err);
  }
  
  res.json({
    messageCount: messageCount.count,
    userCount: userCount.count,
    roomCount: roomCount.count,
    dmCount: dmCount.count,
    dbSizeMB: dbSizeMB.toFixed(2),
  });
});

app.get('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, display_name, avatar_color, is_admin, is_banned, banned_at, banned_reason, created_at, last_seen FROM users ORDER BY created_at DESC').all();
  res.json(users.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    avatarColor: u.avatar_color,
    isAdmin: !!u.is_admin,
    isBanned: !!u.is_banned,
    bannedAt: u.banned_at || null,
    bannedReason: u.banned_reason || null,
    createdAt: u.created_at,
    lastSeen: u.last_seen,
  })));
});

app.post('/api/admin/ban', authMiddleware, requireAdmin, (req, res) => {
  const { userId, reason } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  db.prepare('UPDATE users SET is_banned = 1, banned_at = unixepoch(), banned_reason = ? WHERE id = ?').run(reason || 'Banned by admin', userId);

  for (const [, s] of io.sockets.sockets) {
    if (s.user && s.user.id === userId) {
      s.disconnect(true);
    }
  }

  res.json({ ok: true });
});

app.post('/api/admin/unban', authMiddleware, requireAdmin, (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  db.prepare('UPDATE users SET is_banned = 0, banned_at = NULL, banned_reason = NULL WHERE id = ?').run(userId);
  res.json({ ok: true });
});

app.get('/api/admin/reports', authMiddleware, requireAdmin, (req, res) => {
  const reports = db.prepare(`
    SELECT r.id, r.report_type, r.reason, r.created_at, r.resolved_at, r.resolved_by,
           r.reporter_id, ur.display_name as reporter_name,
           r.reported_user_id, uu.display_name as reported_name,
           r.message_id,
           m.content as message_content, m.is_deleted as message_is_deleted, m.room_id, m.recipient_id, m.message_type, m.created_at as message_created_at
    FROM message_reports r
    JOIN users ur ON r.reporter_id = ur.id
    JOIN users uu ON r.reported_user_id = uu.id
    JOIN messages m ON r.message_id = m.id
    ORDER BY r.created_at DESC
  `).all();

  res.json(reports.map((r) => ({
    id: r.id,
    reportType: r.report_type || 'message',
    reason: r.reason,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at || null,
    resolvedBy: r.resolved_by || null,
    reporter: { id: r.reporter_id, displayName: r.reporter_name },
    reportedUser: { id: r.reported_user_id, displayName: r.reported_name },
    message: {
      id: r.message_id,
      content: r.message_is_deleted ? '' : r.message_content,
      isDeleted: !!r.message_is_deleted,
      roomId: r.room_id || null,
      recipientId: r.recipient_id || null,
      type: r.message_type,
      createdAt: r.message_created_at,
    },
  })));
});

app.post('/api/admin/reports/:reportId/resolve', authMiddleware, requireAdmin, (req, res) => {
  const { reportId } = req.params;
  db.prepare('UPDATE message_reports SET resolved_at = unixepoch(), resolved_by = ? WHERE id = ?').run(req.userId, reportId);
  res.json({ ok: true });
});

app.get('/api/admin/deleted-messages', authMiddleware, (req, res) => {
  const u = ensureLocalUser(req.userId, req.decoded.email, req.userMeta.display_name, req.userMeta.avatar_color, req.userMeta.avatar_url);
  if (!u.is_admin) return res.status(403).json({ error: 'Forbidden' });

  const rows = db.prepare(`
    SELECT dm.id, dm.message_id, dm.deleted_by, dm.deleted_at, dm.reason, dm.original_content,
           dm.room_id, dm.recipient_id, dm.message_type, dm.message_created_at,
           u.id as sender_id, u.display_name as sender_name
    FROM deleted_messages dm
    JOIN users u ON dm.sender_id = u.id
    ORDER BY dm.deleted_at DESC
  `).all();

  res.json(rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    deletedBy: r.deleted_by,
    deletedAt: r.deleted_at,
    reason: r.reason,
    originalContent: r.original_content,
    sender: { id: r.sender_id, displayName: r.sender_name },
    roomId: r.room_id,
    recipientId: r.recipient_id,
    type: r.message_type,
    messageCreatedAt: r.message_created_at,
  })));
});

// Admin: get all feedback from Supabase
app.get('/api/admin/feedback', authMiddleware, async (req, res) => {
  const u = ensureLocalUser(req.userId, req.decoded.email, req.userMeta.display_name, req.userMeta.avatar_color, req.userMeta.avatar_url);
  if (!u.is_admin) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
    );
    
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Supabase feedback fetch error:', error);
      return res.json([]);
    }
    
    res.json(data.map(f => ({
      id: f.id,
      userId: f.user_id,
      displayName: f.display_name,
      type: f.type,
      content: f.content,
      createdAt: f.created_at,
    })));
  } catch (err) {
    console.error('Feedback fetch error:', err);
    res.json([]);
  }
});

// Admin: get all unban requests
app.get('/api/admin/unban-requests', authMiddleware, (req, res) => {
  const u = ensureLocalUser(req.userId, req.decoded.email, req.userMeta.display_name, req.userMeta.avatar_color, req.userMeta.avatar_url);
  if (!u.is_admin) return res.status(403).json({ error: 'Forbidden' });

  const rows = db.prepare(`
    SELECT id, user_id, display_name, message, created_at, resolved_at, resolved_by
    FROM unban_requests
    ORDER BY created_at DESC
  `).all();

  res.json(rows.map(r => ({
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    message: r.message,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
  })));
});

// Admin: resolve unban request (approve)
app.post('/api/admin/unban-requests/:requestId/approve', authMiddleware, requireAdmin, (req, res) => {
  const { requestId } = req.params;
  const request = db.prepare('SELECT user_id FROM unban_requests WHERE id = ?').get(requestId);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  db.prepare('UPDATE users SET is_banned = 0, banned_at = NULL, banned_reason = NULL WHERE id = ?').run(request.user_id);
  db.prepare('UPDATE unban_requests SET resolved_at = unixepoch(), resolved_by = ? WHERE id = ?').run(req.userId, requestId);
  
  res.json({ ok: true });
});

// Admin: resolve unban request (deny)
app.post('/api/admin/unban-requests/:requestId/deny', authMiddleware, requireAdmin, (req, res) => {
  const { requestId } = req.params;
  db.prepare('UPDATE unban_requests SET resolved_at = unixepoch(), resolved_by = ? WHERE id = ?').run(req.userId, requestId);
  res.json({ ok: true });
});

// Track online users: Map<userId, { id, displayName, avatarColor, avatarUrl }>
const onlineUsers = new Map();

function broadcastOnlineUsers() {
  const users = Array.from(onlineUsers.values());
  io.emit('online_users', users);
}

// Get online users
app.get('/api/online', (req, res) => {
  res.json({ count: onlineUsers.size, users: Array.from(onlineUsers.values()) });
});

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));

  const decoded = decodeSupabaseToken(token);
  if (!decoded || !decoded.sub) return next(new Error('Invalid token'));

  const meta = decoded.user_metadata || {};
  const email = decoded.email || meta.email || '';
  const user = ensureLocalUser(decoded.sub, email, meta.display_name, meta.avatar_color, meta.avatar_url);
  const banRow = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(user.id);
  if (banRow && banRow.is_banned) return next(new Error('BANNED'));

  socket.user = user;
  next();
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`✅ ${socket.user.display_name} connected`);

  // Update last seen
  db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?').run(socket.user.id);

  // Track online user
  onlineUsers.set(socket.user.id, {
    id: socket.user.id,
    displayName: socket.user.display_name,
    avatarColor: socket.user.avatar_color,
    avatarUrl: socket.user.avatar_url || null,
  });
  broadcastOnlineUsers();

  // Join a room
  socket.on('join_room', (roomId) => {
    // Verify room exists before joining
    const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
    if (!room) {
      console.log(`⚠️ ${socket.user.display_name} tried to join non-existent room: ${roomId}`);
      return;
    }
    socket.join(`room:${roomId}`);
    console.log(`${socket.user.display_name} joined room: ${roomId}`);
    
    // Mark room as read
    try {
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO room_last_read (user_id, room_id, last_read_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, room_id) DO UPDATE SET last_read_at = ?
      `).run(socket.user.id, roomId, now, now);
    } catch (err) {
      console.error(`Failed to update room_last_read for room ${roomId}:`, err.message);
    }
  });

  socket.on('toggle_reaction', (data) => {
    const { messageId, emoji } = data || {};
    if (!messageId || !emoji || !ALLOWED_REACTIONS.includes(emoji)) return;

    const msg = db.prepare('SELECT id, room_id, sender_id, recipient_id, message_type, is_deleted FROM messages WHERE id = ?').get(messageId);
    if (!msg || msg.is_deleted) return;

    const exists = db.prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(messageId, socket.user.id, emoji);
    if (exists) {
      db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, socket.user.id, emoji);
    } else {
      db.prepare('INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(messageId, socket.user.id, emoji);
    }

    const reactions = Array.from(getReactionSummary([messageId], socket.user.id).get(messageId) || []);

    if (msg.message_type === 'room') {
      io.to(`room:${msg.room_id}`).emit('reaction_updated', { messageId, reactions });
      return;
    }

    // DM: send to both
    socket.emit('reaction_updated', { messageId, reactions });
    for (const [, s] of io.sockets.sockets) {
      if (s.user && (s.user.id === msg.sender_id || s.user.id === msg.recipient_id)) {
        s.emit('reaction_updated', { messageId, reactions });
      }
    }
  });

  socket.on('delete_message', (data) => {
    const { messageId, reason } = data || {};
    if (!messageId) return;

    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!msg || msg.is_deleted) return;

    const actor = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(socket.user.id);
    const isAdmin = !!(actor && actor.is_admin);
    const isAuthor = msg.sender_id === socket.user.id;
    if (!isAdmin && !isAuthor) return;

    const now = Math.floor(Date.now() / 1000);

    db.prepare('UPDATE messages SET is_deleted = 1, deleted_at = ?, deleted_by = ? WHERE id = ?').run(now, socket.user.id, messageId);
    db.prepare(`
      INSERT INTO deleted_messages_log (id, message_id, deleted_by, deleted_at, reason, original_content, sender_id, room_id, recipient_id, message_type, message_created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), messageId, socket.user.id, now, reason || null, msg.content, msg.sender_id, msg.room_id || null, msg.recipient_id || null, msg.message_type, msg.created_at);

    if (msg.message_type === 'room') {
      io.to(`room:${msg.room_id}`).emit('message_deleted', { messageId, deletedBy: socket.user.id, deletedAt: now });
      return;
    }

    socket.emit('message_deleted', { messageId, deletedBy: socket.user.id, deletedAt: now });
    for (const [, s] of io.sockets.sockets) {
      if (s.user && (s.user.id === msg.sender_id || s.user.id === msg.recipient_id)) {
        s.emit('message_deleted', { messageId, deletedBy: socket.user.id, deletedAt: now });
      }
    }
  });

  socket.on('report_message', (data) => {
    const { messageId, reason, type } = data || {};
    if (!messageId || !reason || !REPORT_REASONS.includes(reason)) return;

    const msg = db.prepare('SELECT id, sender_id FROM messages WHERE id = ?').get(messageId);
    if (!msg) return;

    const reportType = type === 'user' ? 'user' : 'message';

    const reportId = uuidv4();
    db.prepare(
      'INSERT INTO message_reports (id, reporter_id, reported_user_id, message_id, report_type, reason) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(reportId, socket.user.id, msg.sender_id, messageId, reportType, reason);

    socket.emit('report_submitted', { ok: true, reportId });
  });

  socket.on('pin_message', (data) => {
    const { messageId } = data || {};
    console.log('[pin_message] Received:', { messageId, is_admin: socket.user.is_admin, user: socket.user.display_name });
    if (!messageId || !socket.user.is_admin) {
      console.log('[pin_message] Rejected: no messageId or not admin');
      return;
    }

    const msg = db.prepare('SELECT id, room_id, content, sender_id FROM messages WHERE id = ? AND message_type = \'room\'').get(messageId);
    console.log('[pin_message] Message found:', msg);
    if (!msg || !msg.room_id) return;

    const existing = db.prepare('SELECT id FROM pinned_messages WHERE message_id = ? AND room_id = ?').get(messageId, msg.room_id);
    if (existing) {
      console.log('[pin_message] Already pinned');
      return;
    }

    const pinId = uuidv4();
    db.prepare('INSERT INTO pinned_messages (id, message_id, room_id, pinned_by) VALUES (?, ?, ?, ?)').run(pinId, messageId, msg.room_id, socket.user.id);

    const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(msg.sender_id);
    const systemMessageId = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    
    db.prepare(`
      INSERT INTO messages (id, room_id, sender_id, content, message_type, created_at)
      VALUES (?, ?, ?, ?, 'room', ?)
    `).run(systemMessageId, msg.room_id, socket.user.id, `📌 pinned a message from ${sender?.display_name || 'someone'}`, now);

    const systemMessage = {
      id: systemMessageId,
      content: `📌 pinned a message from ${sender?.display_name || 'someone'}`,
      created_at: now,
      sender_id: socket.user.id,
      display_name: socket.user.display_name,
      avatar_color: socket.user.avatar_color,
      avatar_url: socket.user.avatar_url || null,
      is_admin: true,
      is_deleted: 0,
      reactions: [],
    };

    io.to(`room:${msg.room_id}`).emit('new_message', { roomId: msg.room_id, message: systemMessage });
    io.to(`room:${msg.room_id}`).emit('message_pinned', { messageId, roomId: msg.room_id, pinnedBy: socket.user.id });
  });

  socket.on('unpin_message', (data) => {
    const { messageId } = data || {};
    if (!messageId || !socket.user.is_admin) return;

    const pinned = db.prepare('SELECT room_id FROM pinned_messages WHERE message_id = ?').get(messageId);
    if (!pinned) return;

    db.prepare('DELETE FROM pinned_messages WHERE message_id = ?').run(messageId);
    io.to(`room:${pinned.room_id}`).emit('message_unpinned', { messageId, roomId: pinned.room_id });
  });

  // Leave a room
  socket.on('leave_room', (roomId) => {
    socket.leave(`room:${roomId}`);
  });

  // Send message to a room
  socket.on('room_message', (data) => {
    const { roomId, content, replyToMessageId } = data;
    if (!content || !content.trim() || !roomId) return;

    const banRow = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(socket.user.id);
    if (banRow && banRow.is_banned) {
      socket.emit('send_error', { code: 'BANNED', message: 'Your account has been suspended' });
      return;
    }

    const userRow = db.prepare('SELECT email FROM users WHERE id = ?').get(socket.user.id);
    const isVerified = userRow && !userRow.email.includes('@noemail.lancschat.lol');
    const sendCheck = canSendMessage(socket.user.id, isVerified);
    if (!sendCheck.ok) {
      const msg = isVerified
        ? "You're sending messages too fast, slow down"
        : "Verify your email in Settings to send messages faster";
      socket.emit('send_error', { code: 'RATE_LIMIT', message: msg, retryAfter: sendCheck.retryAfter });
      return;
    }

    const messageId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    let replyTo = null;
    if (replyToMessageId) {
      const r = db.prepare(
        `SELECT m.id, m.content, m.is_deleted, m.sender_id, u.display_name
         FROM messages m JOIN users u ON m.sender_id = u.id
         WHERE m.id = ? AND m.room_id = ? AND m.message_type = 'room'`
      ).get(replyToMessageId, roomId);
      if (r) {
        replyTo = {
          id: r.id,
          sender_id: r.sender_id,
          display_name: r.display_name,
          content: r.is_deleted ? '' : r.content,
          is_deleted: !!r.is_deleted,
        };
      }
    }

    db.prepare(`
      INSERT INTO messages (id, room_id, sender_id, content, message_type, created_at, reply_to_message_id)
      VALUES (?, ?, ?, ?, 'room', ?, ?)
    `).run(messageId, roomId, socket.user.id, content.trim(), now, replyTo ? replyTo.id : null);

    const message = {
      id: messageId,
      content: content.trim(),
      created_at: now,
      sender_id: socket.user.id,
      reply_to_message_id: replyTo ? replyTo.id : null,
      reply_to: replyTo,
      is_deleted: 0,
      reactions: [],
      display_name: socket.user.display_name,
      avatar_color: socket.user.avatar_color,
      avatar_url: socket.user.avatar_url || null,
      is_admin: !!socket.user.is_admin,
    };

    io.to(`room:${roomId}`).emit('new_message', { roomId, message });

    // Update room preview
    const roomUpdate = {
      roomId,
      last_message: content.trim().substring(0, 100),
      last_message_at: now,
      last_message_sender: socket.user.display_name,
    };
    io.emit('room_updated', roomUpdate);
  });

  // Send a DM
  socket.on('dm_message', (data) => {
    const { recipientId, content, replyToMessageId } = data;
    if (!content || !content.trim() || !recipientId) return;

    const banRow = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(socket.user.id);
    if (banRow && banRow.is_banned) {
      socket.emit('send_error', { code: 'BANNED', message: 'Your account has been suspended' });
      return;
    }

    const dmUserRow = db.prepare('SELECT email FROM users WHERE id = ?').get(socket.user.id);
    const dmIsVerified = dmUserRow && !dmUserRow.email.includes('@noemail.lancschat.lol');
    const sendCheck = canSendMessage(socket.user.id, dmIsVerified);
    if (!sendCheck.ok) {
      const msg = dmIsVerified
        ? "You're sending messages too fast, slow down"
        : "Verify your email in Settings to send messages faster";
      socket.emit('send_error', { code: 'RATE_LIMIT', message: msg, retryAfter: sendCheck.retryAfter });
      return;
    }

    const userId = socket.user.id;
    const messageId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    let replyTo = null;
    if (replyToMessageId) {
      const r = db.prepare(
        `SELECT m.id, m.content, m.is_deleted, m.sender_id, u.display_name
         FROM messages m JOIN users u ON m.sender_id = u.id
         WHERE m.id = ? AND m.message_type = 'dm'
           AND ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))`
      ).get(replyToMessageId, userId, recipientId, recipientId, userId);
      if (r) {
        replyTo = {
          id: r.id,
          sender_id: r.sender_id,
          display_name: r.display_name,
          content: r.is_deleted ? '' : r.content,
          is_deleted: !!r.is_deleted,
        };
      }
    }

    // Ensure DM conversation exists
    const [u1, u2] = [userId, recipientId].sort();
    const existingConvo = db.prepare('SELECT id FROM dm_conversations WHERE user1_id = ? AND user2_id = ?').get(u1, u2);

    if (!existingConvo) {
      const convoId = uuidv4();
      db.prepare('INSERT INTO dm_conversations (id, user1_id, user2_id) VALUES (?, ?, ?)').run(convoId, u1, u2);
    }

    db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, content, message_type, created_at, reply_to_message_id)
      VALUES (?, ?, ?, ?, 'dm', ?, ?)
    `).run(messageId, userId, recipientId, content.trim(), now, replyTo ? replyTo.id : null);

    // Update last_message in dm_conversations
    const convoId = existingConvo ? existingConvo.id : db.prepare('SELECT id FROM dm_conversations WHERE user1_id = ? AND user2_id = ?').get(u1, u2).id;
    db.prepare(`
      UPDATE dm_conversations 
      SET last_message = ?, last_message_at = ?, last_message_sender = ?
      WHERE id = ?
    `).run(content.trim().substring(0, 100), now, userId, convoId);

    const message = {
      id: messageId,
      content: content.trim(),
      created_at: now,
      sender_id: userId,
      reply_to_message_id: replyTo ? replyTo.id : null,
      reply_to: replyTo,
      is_deleted: 0,
      reactions: [],
      display_name: socket.user.display_name,
      avatar_color: socket.user.avatar_color,
      avatar_url: socket.user.avatar_url || null,
      is_admin: !!socket.user.is_admin,
    };

    // Send to both users
    socket.emit('new_dm', { recipientId, message });
    for (const [, s] of io.sockets.sockets) {
      if (s.user && s.user.id === recipientId) {
        s.emit('new_dm', { recipientId: userId, message });
      }
    }
  });

  // Start DM with a user from a room
  socket.on('start_dm', (data) => {
    const { targetUserId } = data;
    if (!targetUserId || targetUserId === socket.user.id) return;

    const targetUser = db.prepare('SELECT id, display_name, avatar_color, avatar_url FROM users WHERE id = ?').get(targetUserId);
    if (!targetUser) return;

    const [u1, u2] = [socket.user.id, targetUserId].sort();
    let convo = db.prepare('SELECT id FROM dm_conversations WHERE user1_id = ? AND user2_id = ?').get(u1, u2);

    if (!convo) {
      const convoId = uuidv4();
      db.prepare('INSERT INTO dm_conversations (id, user1_id, user2_id) VALUES (?, ?, ?)').run(convoId, u1, u2);
      convo = { id: convoId };
    }

    // Mark as read when opening
    const now = Math.floor(Date.now() / 1000);
    const isUser1 = u1 === socket.user.id;
    const column = isUser1 ? 'user1_last_read' : 'user2_last_read';
    db.prepare(`UPDATE dm_conversations SET ${column} = ? WHERE id = ?`).run(now, convo.id);

    socket.emit('dm_started', {
      conversationId: convo.id,
      other_id: targetUser.id,
      other_name: targetUser.display_name,
      other_color: targetUser.avatar_color,
      other_avatar_url: targetUser.avatar_url,
    });
  });

  socket.on('disconnect', () => {
    console.log(`❌ ${socket.user.display_name} disconnected`);
    db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?').run(socket.user.id);
    
    // Check if user has any other active sockets before removing from online list
    const sockets = io.sockets.sockets;
    let stillOnline = false;
    for (const [, s] of sockets) {
      if (s.user && s.user.id === socket.user.id && s.id !== socket.id) {
        stillOnline = true;
        break;
      }
    }
    if (!stillOnline) {
      onlineUsers.delete(socket.user.id);
      broadcastOnlineUsers();
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 LancsChat server running on http://localhost:${PORT}\n`);
});
