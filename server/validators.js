const db = require('./db');

const LANCASTER_DOMAIN = 'lancaster.ac.uk';
const AVATAR_BUCKET = 'avatars';
const VOICE_BUCKET = 'voice-messages';

function isAllowAllEmails() {
  const row = db.prepare("SELECT value FROM site_settings WHERE key = 'allow_all_emails'").get();
  return row?.value === '1';
}

function isEmailAllowed(email) {
  const normalized = (email || '').toLowerCase().trim();
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, error: 'Valid email is required' };
  }
  if (isAllowAllEmails()) {
    return { ok: true, email: normalized };
  }
  const domain = normalized.split('@')[1];
  if (domain !== LANCASTER_DOMAIN) {
    return {
      ok: false,
      error: `LancsChat is exclusive to Lancaster University. Please use your @${LANCASTER_DOMAIN} email.`,
    };
  }
  return { ok: true, email: normalized };
}

function getSupabaseProjectUrl() {
  return (process.env.SUPABASE_URL || '').replace(/\/$/, '');
}

function isValidStoragePublicUrl(url, bucket, userId) {
  if (!url || typeof url !== 'string') return false;
  const base = getSupabaseProjectUrl();
  if (!base || !userId) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const expectedHost = new URL(base).host;
  if (parsed.host !== expectedHost) return false;

  const prefix = `${base}/storage/v1/object/public/${bucket}/${userId}/`;
  return url === prefix || url.startsWith(prefix);
}

function sanitizeAvatarUrl(url, userId) {
  if (!url) return null;
  return isValidStoragePublicUrl(url, AVATAR_BUCKET, userId) ? url : null;
}

function isValidVoiceMessageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const base = getSupabaseProjectUrl();
  if (!base) return false;

  try {
    const parsed = new URL(url);
    if (parsed.host !== new URL(base).host) return false;
  } catch {
    return false;
  }

  return url.includes(`/storage/v1/object/public/${VOICE_BUCKET}/`);
}

module.exports = {
  LANCASTER_DOMAIN,
  isAllowAllEmails,
  isEmailAllowed,
  sanitizeAvatarUrl,
  isValidStoragePublicUrl,
  isValidVoiceMessageUrl,
};
