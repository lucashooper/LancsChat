const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');

export function isValidAvatarUrl(url: string | null | undefined, userId: string): boolean {
  if (!url || !SUPABASE_URL || !userId) return false;
  try {
    const parsed = new URL(url);
    if (parsed.host !== new URL(SUPABASE_URL).host) return false;
  } catch {
    return false;
  }
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/avatars/${userId}/`;
  return url.startsWith(prefix);
}
