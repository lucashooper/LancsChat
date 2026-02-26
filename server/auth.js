const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const db = require('./db');

const router = express.Router();

const ALLOWED_DOMAIN = 'lancaster.ac.uk';
const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F0B27A', '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
  '#A3E4D7', '#FAD7A0', '#A9CCE3', '#D5F5E3', '#FADBD8'
];

const ANONYMOUS_NAMES = [
  'Anonymous Fox', 'Anonymous Owl', 'Anonymous Wolf', 'Anonymous Bear',
  'Anonymous Hawk', 'Anonymous Deer', 'Anonymous Lynx', 'Anonymous Hare',
  'Anonymous Raven', 'Anonymous Otter', 'Anonymous Badger', 'Anonymous Swan',
  'Anonymous Falcon', 'Anonymous Viper', 'Anonymous Moth', 'Anonymous Crane',
  'Anonymous Panda', 'Anonymous Tiger', 'Anonymous Eagle', 'Anonymous Shark',
  'Anonymous Dolphin', 'Anonymous Phoenix', 'Anonymous Dragon', 'Anonymous Lion',
  'Anonymous Panther', 'Anonymous Cobra', 'Anonymous Jaguar', 'Anonymous Sparrow'
];

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function sendVerificationEmail(email, code) {
  // In development, just log the code
  if (process.env.NODE_ENV !== 'production' || !process.env.SMTP_USER || process.env.SMTP_USER === 'your-email@gmail.com') {
    console.log(`\n========================================`);
    console.log(`📧 VERIFICATION CODE for ${email}: ${code}`);
    console.log(`========================================\n`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: `"LancsChat" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Your LancsChat Verification Code',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 28px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px;">LancsChat</h1>
        <p style="color: #666; margin-bottom: 32px;">Verify your Lancaster University email</p>
        <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 24px;">
          <p style="color: #666; margin-bottom: 12px; font-size: 14px;">Your verification code is:</p>
          <h2 style="font-size: 36px; letter-spacing: 8px; color: #1a1a1a; margin: 0;">${code}</h2>
        </div>
        <p style="color: #999; font-size: 12px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Validate email domain
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (emailDomain !== ALLOWED_DOMAIN) {
      return res.status(400).json({ error: 'Only @lancaster.ac.uk email addresses are allowed' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    const existing = db.prepare('SELECT id, is_verified FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing && existing.is_verified) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const code = generateCode();
    const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

    if (existing && !existing.is_verified) {
      // Update existing unverified account
      db.prepare(`
        UPDATE users SET password_hash = ?, verification_code = ?, verification_expires = ?
        WHERE id = ?
      `).run(passwordHash, code, expiresAt, existing.id);

      await sendVerificationEmail(email, code);
      return res.json({ message: 'Verification code sent to your email', userId: existing.id });
    }

    const userId = uuidv4();
    const displayName = getRandomElement(ANONYMOUS_NAMES);
    const avatarColor = getRandomElement(AVATAR_COLORS);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, avatar_color, verification_code, verification_expires)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, email.toLowerCase(), passwordHash, displayName, avatarColor, code, expiresAt);

    await sendVerificationEmail(email, code);

    res.json({ message: 'Verification code sent to your email', userId });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify email
router.post('/verify', (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > user.verification_expires) {
      return res.status(400).json({ error: 'Verification code has expired. Please register again.' });
    }

    if (user.verification_code !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    db.prepare('UPDATE users SET is_verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ?')
      .run(user.id);

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({
      message: 'Email verified successfully',
      token,
      user: {
        id: user.id,
        displayName: user.display_name,
        avatarColor: user.avatar_color,
      },
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    if (!user.is_verified) {
      return res.status(400).json({ error: 'Please verify your email first' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Update last seen
    db.prepare('UPDATE users SET last_seen = unixepoch() WHERE id = ?').run(user.id);

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({
      token,
      user: {
        id: user.id,
        displayName: user.display_name,
        avatarColor: user.avatar_color,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
router.get('/me', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = db.prepare('SELECT id, display_name, avatar_color, created_at FROM users WHERE id = ?').get(decoded.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user.id,
      displayName: user.display_name,
      avatarColor: user.avatar_color,
      createdAt: user.created_at,
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
    console.error('Me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
