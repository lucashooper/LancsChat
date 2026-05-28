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

/** Parse Supabase OAuth/error fragments from the URL hash (e.g. #error=access_denied). */
export function parseAuthHashError(): { message: string; code: string } | null {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const error = params.get('error');
  if (!error) return null;

  const code = params.get('error_code') || error;
  const description = params.get('error_description')?.replace(/\+/g, ' ') || '';

  return { code, message: mapAuthErrorCode(code, description) };
}

export function clearAuthHash(): void {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export function mapAuthErrorCode(code: string, description?: string): string {
  switch (code) {
    case 'otp_expired':
      return 'That verification link has expired or was already used. Log in and tap "Resend verification email" for a fresh one.';
    case 'access_denied':
      if (description?.toLowerCase().includes('expired') || description?.toLowerCase().includes('invalid')) {
        return 'That verification link has expired or was already used. Log in and tap "Resend verification email" for a fresh one.';
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
