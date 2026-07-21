import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';
import { loginApi, logoutApi, decodeJwtPayload } from '../api/auth';
import { configureAuth } from '../api/client';
import { saLogin } from '../api/superAdmin';

interface AuthState {
  token:           string | null;
  hotelId:         string | null;
  hotelName:       string | null;
  role:            string | null;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  login(userId: string, password: string): Promise<void>;
  loginSuperAdmin(userId: string, password: string): Promise<void>;
  logout(): void;
  setHotelName(name: string): void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const KEYS = {
  token:        'pos_token',
  refreshToken: 'pos_refresh_token', // H-02
  hotelId:      'pos_hotel_id',
  hotelName:    'pos_hotel_name',
  role:         'pos_role',
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

  // H-03: register auth callbacks with the API client.
  // These fire when apiFetch silently refreshes a token (onTokenUpdated)
  // or when a refresh fails and the session must be terminated (onAuthExpired).
  // React processes parent effects before child effects, so these callbacks
  // are registered before any child polling useEffects start.
  useEffect(() => {
    configureAuth({
      onTokenUpdated: (newToken, newRefreshToken) => {
        localStorage.setItem(KEYS.token,        newToken);
        localStorage.setItem(KEYS.refreshToken, newRefreshToken);
        // Updating token in state causes SocketContext to reconnect with the new token
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
    const hotelId =
      res.hotelId ??
      (typeof decoded.hotelId === 'string' ? decoded.hotelId : '');
    const role =
      res.role ??
      (typeof decoded.role === 'string' ? decoded.role : null);

    if (role === 'kitchen' || role === 'waiter') {
      throw new Error('Kitchen and Waiter access is available on the mobile app only.');
    }

    localStorage.setItem(KEYS.token,   res.token);
    if (res.refreshToken) {
      localStorage.setItem(KEYS.refreshToken, res.refreshToken);
    }
    localStorage.setItem(KEYS.hotelId, hotelId);
    if (res.hotelName) localStorage.setItem(KEYS.hotelName, res.hotelName);
    if (role) localStorage.setItem(KEYS.role, role);

    setState({
      token:           res.token,
      hotelId,
      hotelName:       res.hotelName ?? null,
      role,
      isAuthenticated: true,
    });
  }, []);

  const loginSuperAdmin = useCallback(async (userId: string, password: string) => {
    const res = await saLogin(userId, password);
    localStorage.setItem(KEYS.token, res.token);
    localStorage.setItem(KEYS.role,  'superadmin');
    setState({
      token:           res.token,
      hotelId:         null,
      hotelName:       null,
      role:            'superadmin',
      isAuthenticated: true,
    });
  }, []);

  // H-02: revoke the refresh token on the server before clearing local state.
  // Fire-and-forget: if the network call fails the token self-expires in 30 days.
  const logout = useCallback(() => {
    const rt = localStorage.getItem(KEYS.refreshToken);
    if (rt) {
      logoutApi(rt).catch(() => {});
    }
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    setState({ token: null, hotelId: null, hotelName: null, role: null, isAuthenticated: false });
  }, []);

  const setHotelName = useCallback((name: string) => {
    localStorage.setItem(KEYS.hotelName, name);
    setState(s => ({ ...s, hotelName: name }));
  }, []);

  const value = useMemo(
    () => ({ ...state, login, loginSuperAdmin, logout, setHotelName }),
    [state, login, loginSuperAdmin, logout, setHotelName],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
