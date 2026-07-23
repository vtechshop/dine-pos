import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { loginApi, logoutApi, decodeJwtPayload } from '../api/auth';
import { configureAuth } from '../api/client';

interface AuthState {
  token:           string | null;
  hotelId:         string | null;
  hotelName:       string | null;
  role:            string | null;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  login(userId: string, password: string): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const KEYS = {
  token:        'admin_token',
  refreshToken: 'admin_refresh_token',
  hotelId:      'admin_hotel_id',
  hotelName:    'admin_hotel_name',
  role:         'admin_role',
} as const;

function readStorage(): AuthState {
  const token = localStorage.getItem(KEYS.token);
  return {
    token,
    hotelId:         localStorage.getItem(KEYS.hotelId),
    hotelName:       localStorage.getItem(KEYS.hotelName),
    role:            localStorage.getItem(KEYS.role),
    isAuthenticated: !!token,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(readStorage);

  useEffect(() => {
    configureAuth({
      onTokenUpdated: (newToken, newRefreshToken) => {
        localStorage.setItem(KEYS.token, newToken);
        localStorage.setItem(KEYS.refreshToken, newRefreshToken);
        setState(s => ({ ...s, token: newToken, isAuthenticated: true }));
      },
      onAuthExpired: () => {
        Object.values(KEYS).forEach(k => localStorage.removeItem(k));
        setState({ token: null, hotelId: null, hotelName: null, role: null, isAuthenticated: false });
      },
    });
  }, []);

  const login = useCallback(async (userId: string, password: string) => {
    const res = await loginApi(userId, password);
    const decoded = decodeJwtPayload(res.token);
    const hotelId = res.hotelId ?? (typeof decoded.hotelId === 'string' ? decoded.hotelId : '');
    const role    = res.role    ?? (typeof decoded.role    === 'string' ? decoded.role    : null);

    if (role !== 'admin') {
      throw new Error('Admin access only. Use the POS app for cashier/kitchen access.');
    }

    localStorage.setItem(KEYS.token,   res.token);
    if (res.refreshToken) localStorage.setItem(KEYS.refreshToken, res.refreshToken);
    localStorage.setItem(KEYS.hotelId, hotelId);
    if (res.hotelName) localStorage.setItem(KEYS.hotelName, res.hotelName);
    if (role)          localStorage.setItem(KEYS.role, role);

    setState({
      token:           res.token,
      hotelId,
      hotelName:       res.hotelName ?? null,
      role,
      isAuthenticated: true,
    });
  }, []);

  const logout = useCallback(() => {
    const rt = localStorage.getItem(KEYS.refreshToken);
    if (rt) logoutApi(rt).catch(() => {});
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    setState({ token: null, hotelId: null, hotelName: null, role: null, isAuthenticated: false });
  }, []);

  const value = useMemo(
    () => ({ ...state, login, logout }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
