import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';
import { loginApi, logoutApi, decodeJwtPayload, loginCashierApi } from '../api/auth';
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
  loginCashier(hotelId: string, employeeCode: string, pin: string): Promise<void>;
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

// Both keys survive logout — they describe the POS terminal itself, not the session.
// Written on admin login; read by the cashier login panel to identify the linked hotel.
const DEVICE_HOTEL_KEY      = 'pos_device_hotel_id';
const DEVICE_HOTEL_NAME_KEY = 'pos_device_hotel_name';

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
        // Super admin sessions are managed via saFetch, not apiFetch.
        // A 401 on a hotel endpoint while logged in as SA is expected — ignore it.
        if (localStorage.getItem(KEYS.role) === 'superadmin') return;
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
    localStorage.setItem(KEYS.hotelId,        hotelId);
    localStorage.setItem(DEVICE_HOTEL_KEY,    hotelId); // persists for cashier panel
    if (res.hotelName) {
      localStorage.setItem(KEYS.hotelName,       res.hotelName);
      localStorage.setItem(DEVICE_HOTEL_NAME_KEY, res.hotelName); // persists for cashier panel
    }
    if (role) localStorage.setItem(KEYS.role, role);

    setState({
      token:           res.token,
      hotelId,
      hotelName:       res.hotelName ?? null,
      role,
      isAuthenticated: true,
    });
  }, []);

  const loginCashier = useCallback(async (hotelId: string, employeeCode: string, pin: string) => {
    const res = await loginCashierApi(hotelId, employeeCode, pin);
    const decoded = decodeJwtPayload(res.token);
    const resolvedHotelId = typeof decoded.hotelId === 'string' ? decoded.hotelId : hotelId;

    localStorage.setItem(KEYS.token,     res.token);
    localStorage.setItem(KEYS.hotelId,   resolvedHotelId);
    localStorage.setItem(KEYS.role,      'cashier');
    localStorage.setItem(DEVICE_HOTEL_KEY, resolvedHotelId);

    setState({
      token:           res.token,
      hotelId:         resolvedHotelId,
      hotelName:       null,
      role:            'cashier',
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
    () => ({ ...state, login, loginCashier, loginSuperAdmin, logout, setHotelName }),
    [state, login, loginCashier, loginSuperAdmin, logout, setHotelName],
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
