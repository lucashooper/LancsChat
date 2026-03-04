import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Session, User as SupaUser } from '@supabase/supabase-js';
import { api } from '../api';

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
  refreshUser: () => Promise<void>;
  markIntroSeen: () => Promise<void>;
}

const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F0B27A', '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
];

function buildUser(supaUser: SupaUser): User {
  const meta = supaUser.user_metadata || {};
  const name = meta.display_name || meta.username || 'Anonymous';
  const colorIndex = supaUser.id.charCodeAt(0) % AVATAR_COLORS.length;
  return {
    id: supaUser.id,
    email: supaUser.email || '',
    displayName: name,
    avatarColor: meta.avatar_color || AVATAR_COLORS[colorIndex],
    avatarUrl: meta.avatar_url || undefined,
  };
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const hydratingRef = { current: false };

  const hydrateServerFlags = async (token: string, base: User, retryCount = 0) => {
    // Prevent duplicate concurrent hydration calls
    if (retryCount === 0 && hydratingRef.current) {
      console.log('[AuthContext] Already hydrating, skipping duplicate call');
      return;
    }
    if (retryCount === 0) hydratingRef.current = true;

    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 10000;
    // Check localStorage for intro-seen as fallback for ephemeral DB
    const localIntroSeen = localStorage.getItem(`lancschat_intro_seen_${base.id}`) === '1';
    try {
      console.log(`[AuthContext] Fetching /me from server... (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
      const res = await fetch(`${API_URL}/me`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || `Server responded ${res.status}`;
        // Retry on 401 (server may still be waking up / JWT not ready)
        if (retryCount < MAX_RETRIES && (res.status === 401 || res.status >= 500)) {
          const delay = Math.min(2000 * (retryCount + 1), 6000);
          console.log(`[AuthContext] Server returned ${res.status}, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          return hydrateServerFlags(token, base, retryCount + 1);
        }
        throw new Error(errMsg);
      }

      const me = await res.json();
      console.log('[AuthContext] Server /me response:', me);
      const introSeen = !!me.hasSeenIntro || localIntroSeen;
      if (introSeen) localStorage.setItem(`lancschat_intro_seen_${base.id}`, '1');
      const finalUser = {
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
      };
      console.log('[AuthContext] Setting final user:', finalUser);
      setUser(finalUser);
    } catch (err) {
      console.error('[AuthContext] Failed to hydrate from server:', err);
      if (retryCount < MAX_RETRIES && (err instanceof DOMException || (err as Error).message?.includes('Failed to fetch'))) {
        const delay = Math.min(2000 * (retryCount + 1), 6000);
        console.log(`[AuthContext] Retrying in ${delay}ms... (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
        return hydrateServerFlags(token, base, retryCount + 1);
      }
      // Fallback: set user without server flags so app still loads
      console.log('[AuthContext] All retries exhausted, using fallback user');
      setUser({ ...base, hasSeenIntro: localIntroSeen || true });
    } finally {
      if (retryCount === 0) hydratingRef.current = false;
    }
  };

  const refreshUser = async () => {
    console.log('[AuthContext] refreshUser called');
    const { data } = await supabase.auth.getSession();
    console.log('[AuthContext] Session data:', data.session?.user?.user_metadata);
    if (data.session?.user) {
      setSession(data.session);
      const base = buildUser(data.session.user);
      console.log('[AuthContext] Built user from session:', base);
      await hydrateServerFlags(data.session.access_token, base);
      console.log('[AuthContext] User hydrated from server');
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) {
        setLoading(true);
        const base = buildUser(s.user);
        void hydrateServerFlags(s.access_token, base).finally(() => setLoading(false));
        return;
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (s?.user) {
        const shouldBlockUI = event !== 'USER_UPDATED';
        if (shouldBlockUI) setLoading(true);
        const base = buildUser(s.user);
        void hydrateServerFlags(s.access_token, base).finally(() => {
          if (shouldBlockUI) setLoading(false);
        });
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  const markIntroSeen = async () => {
    const token = session?.access_token;
    if (!token || !user) return;
    localStorage.setItem(`lancschat_intro_seen_${user.id}`, '1');
    try {
      await api('/me/intro-seen', { method: 'POST', token });
    } catch (err) {
      console.error('[AuthContext] Failed to persist intro-seen on server:', err);
    }
    setUser({ ...user, hasSeenIntro: true });
  };

  const token = session?.access_token || null;

  return (
    <AuthContext.Provider value={{ user, session, token, logout, loading, refreshUser, markIntroSeen }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
