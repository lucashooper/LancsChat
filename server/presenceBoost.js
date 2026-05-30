/**
 * Ambient presence — keeps a small rotating set of plausible-looking users
 * in the online list so the app doesn't feel empty at launch.
 * IDs are prefixed with "presence_" so clients can hide DM actions.
 */

const POOL = [
  { displayName: 'alex_m', avatarColor: '#4ECDC4' },
  { displayName: 'study_grind', avatarColor: '#FF6B6B' },
  { displayName: 'bowland_b', avatarColor: '#45B7D1' },
  { displayName: 'mia', avatarColor: '#FFEAA7' },
  { displayName: 'library_rat', avatarColor: '#85C1E9' },
  { displayName: 'tom', avatarColor: '#F0B27A' },
  { displayName: 'emma_k9', avatarColor: '#DDA0DD' },
  { displayName: 'alexandra', avatarColor: '#82E0AA' },
  { displayName: 'williamson', avatarColor: '#F1948A' },
  { displayName: 'grizedale_g', avatarColor: '#98D8C8' },
  { displayName: 'pendle_rat', avatarColor: '#AED6F1' },
  { displayName: 'lonny', avatarColor: '#F7DC6F' },
  { displayName: 'cartmel_c', avatarColor: '#D7BDE2' },
];

const ACTIVE_COUNT = 4;
let active = [];
let onRotate = null;

function pickFromPool(excludeNames = new Set()) {
  const available = POOL.filter((p) => !excludeNames.has(p.displayName));
  const source = available.length > 0 ? available : POOL;
  return source[Math.floor(Math.random() * source.length)];
}

function buildPresenceUser(profile, slot) {
  return {
    id: `presence_${slot}`,
    displayName: profile.displayName,
    avatarColor: profile.avatarColor,
    avatarUrl: null,
    isPresenceBoost: true,
  };
}

function refreshActive(initial = false) {
  if (initial || active.length === 0) {
    const used = new Set();
    active = [];
    for (let i = 0; i < ACTIVE_COUNT; i++) {
      const profile = pickFromPool(used);
      used.add(profile.displayName);
      active.push(buildPresenceUser(profile, i));
    }
    return;
  }

  const slot = Math.floor(Math.random() * active.length);
  const used = new Set(active.map((u) => u.displayName));
  const profile = pickFromPool(used);
  active[slot] = buildPresenceUser(profile, slot);
}

function getBoostedOnlineUsers(realUsers = []) {
  return [...realUsers, ...active];
}

function getOnlineCount(realCount = 0) {
  return realCount + active.length;
}

/** Call once at server startup. `rebroadcast` runs after each rotation. */
function startPresenceRotation(rebroadcast, intervalMs = 55_000) {
  onRotate = rebroadcast;
  refreshActive(true);

  setInterval(() => {
    refreshActive(false);
    if (onRotate) onRotate();
  }, intervalMs);
}

module.exports = {
  getBoostedOnlineUsers,
  getOnlineCount,
  startPresenceRotation,
};
