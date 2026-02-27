const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'lancschat.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    is_verified INTEGER DEFAULT 0,
    verification_code TEXT,
    verification_expires INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    last_seen INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT '💬',
    is_default INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT,
    sender_id TEXT NOT NULL,
    recipient_id TEXT,
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'room',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS dm_conversations (
    id TEXT PRIMARY KEY,
    user1_id TEXT NOT NULL,
    user2_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user1_id) REFERENCES users(id),
    FOREIGN KEY (user2_id) REFERENCES users(id),
    UNIQUE(user1_id, user2_id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(sender_id, recipient_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
`);

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(table, columnDef) {
  const columnName = columnDef.trim().split(/\s+/)[0];
  if (columnExists(table, columnName)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
}

addColumnIfMissing('users', 'is_admin INTEGER DEFAULT 0');
addColumnIfMissing('users', 'is_banned INTEGER DEFAULT 0');
addColumnIfMissing('users', 'banned_at INTEGER');
addColumnIfMissing('users', 'banned_reason TEXT');
addColumnIfMissing('users', 'has_seen_intro INTEGER DEFAULT 0');
addColumnIfMissing('users', 'avatar_url TEXT');

addColumnIfMissing('messages', 'reply_to_message_id TEXT');
addColumnIfMissing('messages', 'is_deleted INTEGER DEFAULT 0');
addColumnIfMissing('messages', 'deleted_at INTEGER');
addColumnIfMissing('messages', 'deleted_by TEXT');

addColumnIfMissing('dm_conversations', 'last_message TEXT');
addColumnIfMissing('dm_conversations', 'last_message_at INTEGER');
addColumnIfMissing('dm_conversations', 'last_message_sender TEXT');
addColumnIfMissing('dm_conversations', 'user1_last_read INTEGER DEFAULT 0');
addColumnIfMissing('dm_conversations', 'user2_last_read INTEGER DEFAULT 0');

db.exec(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
  CREATE INDEX IF NOT EXISTS idx_reactions_user ON message_reactions(user_id);

  CREATE TABLE IF NOT EXISTS message_reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    reported_user_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    report_type TEXT DEFAULT 'message',
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (reporter_id) REFERENCES users(id),
    FOREIGN KEY (reported_user_id) REFERENCES users(id),
    FOREIGN KEY (message_id) REFERENCES messages(id)
  );

  CREATE TABLE IF NOT EXISTS deleted_messages_log (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    deleted_by TEXT NOT NULL,
    deleted_at INTEGER NOT NULL,
    reason TEXT,
    original_content TEXT,
    sender_id TEXT,
    room_id TEXT,
    recipient_id TEXT,
    message_type TEXT,
    message_created_at INTEGER,
    FOREIGN KEY (deleted_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS unban_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_unban_requests_user ON unban_requests(user_id);
  CREATE INDEX IF NOT EXISTS idx_unban_requests_created ON unban_requests(created_at);

  CREATE TABLE IF NOT EXISTS room_last_read (
    user_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    last_read_at INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, room_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_room_last_read_user ON room_last_read(user_id);

  CREATE TABLE IF NOT EXISTS pinned_messages (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    pinned_by TEXT NOT NULL,
    pinned_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (pinned_by) REFERENCES users(id),
    UNIQUE(message_id, room_id)
  );
`);

addColumnIfMissing('message_reports', "report_type TEXT DEFAULT 'message'");

// Seed default rooms if they don't exist
const roomCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get();
if (roomCount.count === 0) {
  const insertRoom = db.prepare('INSERT INTO rooms (id, name, description, icon, is_default) VALUES (?, ?, ?, ?, 1)');
  const defaultRooms = [
    ['general', 'General', 'The main hangout for all Lancaster students', '🏠'],
    ['memes', 'Memes & Banter', 'Lancaster memes and general banter', '😂'],
    ['confessions', 'Confessions', 'Get things off your chest anonymously', '🤫'],
    ['academic', 'Academic', 'Course help, study groups, exam chat', '📚'],
    ['accommodation', 'Accommodation', 'Housing, flatmates, campus living', '🏡'],
    ['events', 'Events & Socials', 'What\'s happening around campus', '🎉'],
    ['advice', 'Advice', 'Ask for advice from fellow students', '💡'],
    ['sports', 'Sports & Societies', 'Clubs, sports, and society chat', '⚽'],
  ];

  const insertMany = db.transaction((rooms) => {
    for (const room of rooms) {
      insertRoom.run(...room);
    }
  });
  insertMany(defaultRooms);
}

module.exports = db;
