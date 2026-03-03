const db = require('./db');

// Manually create admin account for l.j.hooper@lancaster.ac.uk
const userId = 'd2b8f756-9a14-4675-8e17-f3b889e0801c';
const email = 'l.j.hooper@lancaster.ac.uk';
const displayName = 'crupid';
const avatarColor = '#F0B27A';

try {
  // Check if user already exists
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  
  if (existing) {
    console.log('User already exists, updating...');
    db.prepare('UPDATE users SET display_name = ?, is_admin = 1, is_verified = 1 WHERE id = ?')
      .run(displayName, userId);
    console.log('✅ Admin account updated successfully');
  } else {
    console.log('Creating new admin account...');
    db.prepare(`
      INSERT INTO users (id, email, display_name, avatar_color, is_admin, is_verified, created_at, last_seen)
      VALUES (?, ?, ?, ?, 1, 1, unixepoch(), unixepoch())
    `).run(userId, email, displayName, avatarColor);
    console.log('✅ Admin account created successfully');
  }
  
  // Verify
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  console.log('\nAccount details:', {
    email: user.email,
    displayName: user.display_name,
    isAdmin: user.is_admin === 1,
    isVerified: user.is_verified === 1
  });
  
} catch (err) {
  console.error('❌ Error:', err.message);
}
