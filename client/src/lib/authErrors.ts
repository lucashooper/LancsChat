/** True when the URL hash looks like a successful Supabase implicit-flow auth callback. */
export function hashHasAuthTokens(): boolean {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return false;
  const params = new URLSearchParams(raw);
  return (
    params.has('access_token') ||
    params.has('refresh_token') ||
    params.get('type') === 'signup' ||
    params.get('type') === 'recovery' ||
    params.get('type') === 'email'
  );
}

/** True when the URL has a PKCE ?code= param (Supabase processes this automatically). */
export function hasPkceCode(): boolean {
  return new URLSearchParams(window.location.search).has('code');
}

/** Remove ?code= from the URL after Supabase has exchanged it for a session. */
export function clearPkceCode(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.has('code')) {
    url.searchParams.delete('code');
    window.history.replaceState(null, '', url.toString());
  }
}

/**
 * When the otp_expired / access_denied error appears it almost always means Safe Links
 * pre-scanned the email and confirmed the account already. Treat it as 'confirmed' so
 * the UI can show a success state and prompt the user to sign in rather than showing
 * a red error message.
 */
function classifyErrorCode(code: string, description: string): 'confirmed' | 'error' {
  if (code === 'otp_expired') return 'confirmed';
  if (code === 'access_denied') {
    const d = description.toLowerCase();
    if (d.includes('expired') || d.includes('invalid')) return 'confirmed';
  }
  return 'error';
}

/**
 * Parse Supabase auth errors from both the URL hash (#error=...) and query string (?error=...).
 * PKCE flow uses query params for errors; implicit flow uses hash fragments.
 * Returns a `type` of 'confirmed' when Safe Links likely pre-consumed the token (email is
 * already confirmed in Supabase), or 'error' for genuine failures.
 */
export function parseAuthHashError(): { message: string; code: string; type: 'confirmed' | 'error' } | null {
  // Check query string first (PKCE flow redirects errors as ?error=...)
  const qp = new URLSearchParams(window.location.search);
  if (qp.get('error')) {
    const code = qp.get('error_code') || qp.get('error') || '';
    const description = qp.get('error_description')?.replace(/\+/g, ' ') || '';
    return { code, message: mapAuthErrorCode(code, description), type: classifyErrorCode(code, description) };
  }

  // Fall back to hash fragment (implicit flow / legacy)
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const error = params.get('error');
  if (!error) return null;
  const code = params.get('error_code') || error;
  const description = params.get('error_description')?.replace(/\+/g, ' ') || '';
  return { code, message: mapAuthErrorCode(code, description), type: classifyErrorCode(code, description) };
}

/** Remove auth error params from both the URL hash and query string. */
export function clearAuthHash(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ['error', 'error_code', 'error_description']) {
    if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
  }
  if (changed || url.hash) {
    url.hash = '';
    window.history.replaceState(null, '', url.toString().replace(/\?$/, ''));
  }
}

export function mapAuthErrorCode(code: string, description?: string): string {
  switch (code) {
    case 'otp_expired':
      return 'Email confirmed! Sign in below to get started.';
    case 'access_denied':
      if (description?.toLowerCase().includes('expired') || description?.toLowerCase().includes('invalid')) {
        return 'Email confirmed! Sign in below to get started.';
      }
      return description || 'Access was denied. Please try logging in again.';
    case 'email_not_confirmed':
      return 'Please verify your email before logging in. Check your inbox for the confirmation link.';
    case 'ACCOUNT_DELETED':
      return 'This account no longer exists. Please create a new account or log in with a different email.';
    default:
      return description || 'Something went wrong during sign-in. Please try again.';
  }
}

export function isNoEmailAccount(email: string | null | undefined): boolean {
  return !!email && email.includes('@noemail.lancschat.lol');
}

export function isEmailVerified(email: string | null | undefined, confirmedAt: string | null | undefined): boolean {
  if (isNoEmailAccount(email)) return true;
  return !!confirmedAt;
}
