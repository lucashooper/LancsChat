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

  const hydrateServerFlags = async (token: string, base: User) => {
    try {
      const me = await api('/me', { token });
      setUser({
        ...base,
        email: me.email || base.email,
        displayName: me.displayName || base.displayName,
        avatarColor: me.avatarColor || base.avatarColor,
        isAdmin: !!me.isAdmin,
        isBanned: !!me.isBanned,
        bannedReason: me.bannedReason || null,
        hasSeenIntro: !!me.hasSeenIntro,
      });
    } catch {
      setUser(base);
    }
  };

  const refreshUser = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      setSession(data.session);
      const base = buildUser(data.session.user);
      await hydrateServerFlags(data.session.access_token, base);
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
    await api('/me/intro-seen', { method: 'POST', token });
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
