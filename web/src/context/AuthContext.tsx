import {
  createContext,
  useContext,
  useState,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import { loginApi, decodeJwtPayload } from '../api/auth';

interface AuthState {
  token: string | null;
  hotelId: string | null;
  hotelName: string | null;
  role: string | null;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  login(userId: string, password: string): Promise<void>;
  logout(): void;
  setHotelName(name: string): void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const KEYS = {
  token:     'pos_token',
  hotelId:   'pos_hotel_id',
  hotelName: 'pos_hotel_name',
  role:      'pos_role',
} as const;

function readStorage(): AuthState {
  const token = localStorage.getItem(KEYS.token);
  return {
    token,
    hotelId:   localStorage.getItem(KEYS.hotelId),
    hotelName: localStorage.getItem(KEYS.hotelName),
    role:      localStorage.getItem(KEYS.role),
    isAuthenticated: !!token,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(readStorage);

  const login = useCallback(async (userId: string, password: string) => {
    const res = await loginApi(userId, password);

    // Prefer explicit hotelId from body; fall back to JWT payload
    const decoded = decodeJwtPayload(res.token);
    const hotelId =
      res.hotelId ??
      (typeof decoded.hotelId === 'string' ? decoded.hotelId : '');
    const role =
      res.role ??
      (typeof decoded.role === 'string' ? decoded.role : null);

    localStorage.setItem(KEYS.token,   res.token);
    localStorage.setItem(KEYS.hotelId, hotelId);
    if (role) localStorage.setItem(KEYS.role, role);

    setState({
      token:           res.token,
      hotelId,
      hotelName:       null,
      role,
      isAuthenticated: true,
    });
  }, []);

  const logout = useCallback(() => {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    setState({ token: null, hotelId: null, hotelName: null, role: null, isAuthenticated: false });
  }, []);

  const setHotelName = useCallback((name: string) => {
    localStorage.setItem(KEYS.hotelName, name);
    setState(s => ({ ...s, hotelName: name }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, setHotelName }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
