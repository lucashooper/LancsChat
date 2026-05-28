import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Session, User as SupaUser } from '@supabase/supabase-js';
import { api } from '../api';
import { clearAuthHash, clearPkceCode, hasPkceCode, hashHasAuthTokens, mapAuthErrorCode, parseAuthHashError } from '../lib/authErrors';

interface User {
  id: string;
  email: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  isBanned?: boolean;
  bannedReason?: string | null;
  hasSeenIntro?: boolean;
  emailConfirmed?: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  token: string | null;
  logout: () => Promise<void>;
  loading: boolean;
  authMessage: string | null;
  clearAuthMessage: () => void;
  refreshUser: () => Promise<void>;
  markIntroSeen: () => Promise<void>;
}

const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F0B27A', '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
];

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function buildUser(supaUser: SupaUser): User {
  const meta = supaUser.user_metadata || {};
  const name = meta.display_name || meta.username || 'Anonymous';
  const colorIndex = supaUser.id.charCodeAt(0) % AVATAR_COLORS.length;
  const isNoEmail = (supaUser.email || '').includes('@noemail.lancschat.lol');
  return {
    id: supaUser.id,
    email: supaUser.email || '',
    displayName: name,
    avatarColor: meta.avatar_color || AVATAR_COLORS[colorIndex],
    avatarUrl: meta.avatar_url || undefined,
    // Derive emailConfirmed directly from Supabase session — no-email accounts are always confirmed
    emailConfirmed: isNoEmail || !!supaUser.email_confirmed_at,
  };
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof DOMException) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('ERR_CONNECTION_REFUSED') ||
    msg.includes('ECONNREFUSED')
  );
}

function logAuth(level: 'info' | 'warn' | 'error', event: string, detail?: Record<string, unknown>) {
  const prefix = `[Auth] ${event}`;
  const payload = detail ? ` — ${JSON.stringify(detail)}` : '';
  if (level === 'error') console.error(prefix + payload);
  else if (level === 'warn') console.warn(prefix + payload);
  else console.log(prefix + payload);
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const hydratingRef = useRef(false);

  const signOutWithMessage = async (message: string) => {
    logAuth('warn', 'Signing out', { reason: message });
    setAuthMessage(message);
    setUser(null);
    setSession(null);
    await supabase.auth.signOut();
  };

  const hydrateServerFlags = async (token: string, base: User, retryCount = 0) => {
    if (retryCount === 0 && hydratingRef.current) {
      logAuth('info', 'Hydration already in progress, skipping duplicate call');
      return;
    }
    if (retryCount === 0) hydratingRef.current = true;

    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 8000;
    const localIntroSeen = localStorage.getItem(`lancschat_intro_seen_${base.id}`) === '1';

    try {
      logAuth('info', 'Fetching profile from server', {
        userId: base.id,
        attempt: `${retryCount + 1}/${MAX_RETRIES + 1}`,
        server: API_URL,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const res = await fetch(`${API_URL}/me`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errCode = errData.code as string | undefined;
        const errMsg = errData.error || `HTTP ${res.status}`;

        // Explicit auth failures → sign out
        if (res.status === 401 || errCode === 'ACCOUNT_DELETED') {
          await signOutWithMessage(mapAuthErrorCode('ACCOUNT_DELETED'));
          return;
        }

        if (retryCount < MAX_RETRIES && res.status >= 500) {
          const delay = 2000 * (retryCount + 1);
          logAuth('warn', 'Server error, retrying', { status: res.status, retryInMs: delay });
          await new Promise((r) => setTimeout(r, delay));
          return hydrateServerFlags(token, base, retryCount + 1);
        }

        throw new Error(errMsg);
      }

      const me = await res.json();
      logAuth('info', 'Profile loaded from server', {
        userId: base.id,
        emailConfirmed: !!me.emailConfirmed,
        isBanned: !!me.isBanned,
        isAdmin: !!me.isAdmin,
      });

      const introSeen = !!me.hasSeenIntro || localIntroSeen;
      if (introSeen) localStorage.setItem(`lancschat_intro_seen_${base.id}`, '1');

      setUser({
        ...base,
        email: me.email || base.email,
        displayName: me.displayName || base.displayName,
        avatarColor: me.avatarColor || base.avatarColor,
        avatarUrl: me.avatarUrl || base.avatarUrl,
        isAdmin: !!me.isAdmin,
        isBanned: !!me.isBanned,
        bannedReason: me.bannedReason || null,
        hasSeenIntro: introSeen,
        emailConfirmed: !!me.emailConfirmed,
      });
    } catch (err) {
      const netError = isNetworkError(err);
      const reason = netError
        ? `Server unreachable (${API_URL}) — check VITE_API_URL or Render status`
        : err instanceof Error ? err.message : String(err);

      if (retryCount < MAX_RETRIES && netError) {
        const delay = 2000 * (retryCount + 1);
        logAuth('warn', 'Server unreachable, retrying', {
          attempt: `${retryCount + 1}/${MAX_RETRIES}`,
          retryInMs: delay,
        });
        await new Promise((r) => setTimeout(r, delay));
        return hydrateServerFlags(token, base, retryCount + 1);
      }

      if (netError) {
        // Server just unreachable (cold start, local dev without server, etc.)
        // Don't sign out — use Supabase session data as fallback
        logAuth('warn', 'Server unreachable after retries — using offline session', {
          reason,
          userId: base.id,
          emailConfirmedFromSupabase: base.emailConfirmed,
        });
        const introSeen = localStorage.getItem(`lancschat_intro_seen_${base.id}`) === '1';
        setUser({ ...base, hasSeenIntro: introSeen });
      } else {
        // Non-network failure (bad response, auth error) → sign out
        logAuth('error', 'Auth error from server — signing out', { reason, userId: base.id });
        await signOutWithMessage('Could not verify your account. Please log in again.');
      }
    } finally {
      if (retryCount === 0) hydratingRef.current = false;
    }
  };

  const refreshUser = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      setSession(data.session);
      await hydrateServerFlags(data.session.access_token, buildUser(data.session.user));
    }
  };

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // getSession() with PKCE flow automatically calls exchangeCodeForSession()
      // when ?code= is present, so we must call it BEFORE reading the URL ourselves.
      const { data: { session: initialSession } } = await supabase.auth.getSession();

      // After getSession processes everything, clean up the URL
      if (hasPkceCode()) {
        logAuth('info', 'PKCE code exchanged successfully', { hasSession: !!initialSession });
        clearPkceCode();
      }

      // Only treat hash as an error if Supabase didn't produce a valid session from it
      const hashError = parseAuthHashError();
      const hasAuthTokens = hashHasAuthTokens();

      if (hashError && !initialSession && !hasAuthTokens) {
        clearAuthHash();
        logAuth('warn', 'Auth callback error in URL hash', { code: hashError.code });
        setAuthMessage(hashError.message);
        await supabase.auth.signOut();
        if (mounted) {
          setSession(null);
          setUser(null);
          setLoading(false);
        }
        return;
      }

      if (initialSession?.user || hasAuthTokens) clearAuthHash();

      if (initialSession?.user) {
        setSession(initialSession);
        setLoading(true);
        await hydrateServerFlags(initialSession.access_token, buildUser(initialSession.user));
        if (mounted) setLoading(false);
        return;
      }

      if (mounted) setLoading(false);
    };

    void init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      logAuth('info', 'Auth state change', { event, hasSession: !!s });

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') clearAuthHash();

      // Ignore events while init is processing a hash error (no session, no tokens)
      const hashError = parseAuthHashError();
      if (hashError && !s && !hashHasAuthTokens()) return;

      setSession(s);
      if (s?.user) {
        const shouldBlockUI = event !== 'USER_UPDATED';
        if (shouldBlockUI) setLoading(true);
        void hydrateServerFlags(s.access_token, buildUser(s.user)).finally(() => {
          if (shouldBlockUI) setLoading(false);
        });
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setAuthMessage(null);
  };

  const clearAuthMessage = () => setAuthMessage(null);

  const markIntroSeen = async () => {
    const token = session?.access_token;
    if (!token || !user) return;
    localStorage.setItem(`lancschat_intro_seen_${user.id}`, '1');
    try {
      await api('/me/intro-seen', { method: 'POST', token });
    } catch {
      // Non-critical — already saved to localStorage
    }
    setUser({ ...user, hasSeenIntro: true });
  };

  const token = session?.access_token || null;

  return (
    <AuthContext.Provider
      value={{ user, session, token, logout, loading, authMessage, clearAuthMessage, refreshUser, markIntroSeen }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
