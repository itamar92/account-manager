import React, { createContext, useContext, useEffect, useState } from 'react';
import { get, post } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'band';
}

/** What the app calls itself and the band — set in Settings → כללי, shown everywhere. */
export interface Branding {
  app_name: string;
  band_name: string;
}

export const DEFAULT_BRANDING: Branding = { app_name: 'Account Manager', band_name: 'הלהקה' };

interface AuthContextType {
  user: User | null;
  branding: Branding;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<{ user: User | null; branding?: Branding }>('/auth/me')
      .then((d) => {
        setUser(d.user);
        if (d.branding) setBranding({ ...DEFAULT_BRANDING, ...d.branding });
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const d = await post<{ user: User }>('/auth/login', { email, password });
    setUser(d.user);
  };

  const logout = async () => {
    await post('/auth/logout');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, branding, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
