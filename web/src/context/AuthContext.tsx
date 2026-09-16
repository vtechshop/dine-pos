import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';
import { loginApi, logoutApi, decodeJwtPayload, loginCashierApi, refreshTokenApi } from '../api/auth';
import { configureAuth } from '../api/client';
import { saLogin } from '../api/superAdmin';

interface AuthState {
  token:           string | null;
  hotelId:         string | null;
  hotelName:       string | null;
  role:            string | null;
  isAuthenticated: boolean;
  // Non-null when operating inside a branch context (HQ admin switched to a branch)
  orgHotelId:      string | null;
  orgHotelName:    string | null;
}

export interface SwitchBranchParams {
  branchToken:        string;
  branchRefreshToken: string;
  branchId:           string;
  branchName:         string;
  orgHotelId:         string;
  orgHotelName:       string;
}

interface AuthContextType extends AuthState {
  login(userId: string, password: string): Promise<void>;
  loginCashier(hotelId: string, employeeCode: string, pin: string): Promise<void>;
  loginSuperAdmin(userId: string, password: string): Promise<void>;
  logout(): void;
  setHotelName(name: string): void;
  /** Switch to a branch context. Saves the current HQ token for restoration. */
  switchToBranch(params: SwitchBranchParams): void;
  /** Restore the original HQ context, refreshing HQ token proactively. */
  switchToOrg(): Promise<void>;
  /** True when operating inside a branch (not HQ context). */
  isInBranchContext: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const KEYS = {
  token:        'pos_token',
  refreshToken: 'pos_refresh_token', // H-02
  hotelId:      'pos_hotel_id',
  hotelName:    'pos_hotel_name',
  role:         'pos_role',
} as const;

// Saved HQ context — set when switching into a branch; cleared on switchToOrg/logout
const ORG_KEYS = {
  orgToken:     'pos_org_token',
  orgRefToken:  'pos_org_refresh_token',
  orgHotelId:   'pos_org_hotel_id',
  orgHotelName: 'pos_org_hotel_name',
} as const;

// Both keys survive logout — they describe the POS terminal itself, not the session.
// Written on admin login; read by the cashier login panel to identify the linked hotel.
const DEVICE_HOTEL_KEY      = 'pos_device_hotel_id';
const DEVICE_HOTEL_NAME_KEY = 'pos_device_hotel_name';

function readStorage(): AuthState {
  const role = localStorage.getItem(KEYS.role);
  const token = role === 'superadmin'
    ? localStorage.getItem('sa_token')
    : localStorage.getItem(KEYS.token);
  return {
    token,
    hotelId:         localStorage.getItem(KEYS.hotelId),
    hotelName:       localStorage.getItem(KEYS.hotelName),
    role,
    isAuthenticated: !!token,
    orgHotelId:      localStorage.getItem(ORG_KEYS.orgHotelId),
    orgHotelName:    localStorage.getItem(ORG_KEYS.orgHotelName),
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
        Object.values(ORG_KEYS).forEach(k => localStorage.removeItem(k));
        setState({ token: null, hotelId: null, hotelName: null, role: null, isAuthenticated: false, orgHotelId: null, orgHotelName: null });
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
      orgHotelId:      null,
      orgHotelName:    null,
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
      orgHotelId:      null,
      orgHotelName:    null,
    });
  }, []);

  const loginSuperAdmin = useCallback(async (userId: string, password: string) => {
    const res = await saLogin(userId, password);
    localStorage.setItem('sa_token', res.token);
    localStorage.setItem(KEYS.role,  'superadmin');
    setState({
      token:           res.token,
      hotelId:         null,
      hotelName:       null,
      role:            'superadmin',
      isAuthenticated: true,
      orgHotelId:      null,
      orgHotelName:    null,
    });
  }, []);

  // H-02: revoke the refresh token on the server before clearing local state.
  // Fire-and-forget: if the network call fails the token self-expires in 30 days.
  const logout = useCallback(() => {
    const rt = localStorage.getItem(KEYS.refreshToken);
    if (rt) {
      logoutApi(rt).catch(() => {});
    }
    // Also revoke the org token's refresh if we're in branch context
    const orgRt = localStorage.getItem(ORG_KEYS.orgRefToken);
    if (orgRt) {
      logoutApi(orgRt).catch(() => {});
    }
    localStorage.removeItem('sa_token');
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    Object.values(ORG_KEYS).forEach(k => localStorage.removeItem(k));
    setState({ token: null, hotelId: null, hotelName: null, role: null, isAuthenticated: false, orgHotelId: null, orgHotelName: null });
  }, []);

  const switchToBranch = useCallback((params: SwitchBranchParams) => {
    const { branchToken, branchRefreshToken, branchId, branchName, orgHotelId, orgHotelName } = params;

    // Save the HQ context the first time we enter branch mode (don't overwrite if already in a branch)
    if (!localStorage.getItem(ORG_KEYS.orgToken)) {
      const currentToken   = localStorage.getItem(KEYS.token)        || '';
      const currentRefresh = localStorage.getItem(KEYS.refreshToken)  || '';
      const currentHotelId = localStorage.getItem(KEYS.hotelId)       || '';
      const currentName    = localStorage.getItem(KEYS.hotelName)     || '';
      if (currentToken)   localStorage.setItem(ORG_KEYS.orgToken,     currentToken);
      if (currentRefresh) localStorage.setItem(ORG_KEYS.orgRefToken,  currentRefresh);
      if (currentHotelId) localStorage.setItem(ORG_KEYS.orgHotelId,   currentHotelId);
      if (currentName)    localStorage.setItem(ORG_KEYS.orgHotelName, currentName);
    } else {
      // Already in branch context (switching between branches) — ensure org identity is current
      localStorage.setItem(ORG_KEYS.orgHotelId,   orgHotelId);
      localStorage.setItem(ORG_KEYS.orgHotelName, orgHotelName);
    }

    localStorage.setItem(KEYS.token,        branchToken);
    localStorage.setItem(KEYS.refreshToken, branchRefreshToken);
    localStorage.setItem(KEYS.hotelId,      branchId);
    localStorage.setItem(KEYS.hotelName,    branchName);

    setState(s => ({
      ...s,
      token:        branchToken,
      hotelId:      branchId,
      hotelName:    branchName,
      orgHotelId,
      orgHotelName,
      isAuthenticated: true,
    }));
  }, []);

  const switchToOrg = useCallback(async () => {
    const orgToken    = localStorage.getItem(ORG_KEYS.orgToken);
    const orgRefToken = localStorage.getItem(ORG_KEYS.orgRefToken);
    const orgHotelId  = localStorage.getItem(ORG_KEYS.orgHotelId);
    const orgName     = localStorage.getItem(ORG_KEYS.orgHotelName);
    if (!orgToken || !orgHotelId) return; // not in branch context

    let activeOrgToken    = orgToken;
    let activeOrgRefToken = orgRefToken;

    // Proactively refresh the HQ access token to avoid operating with a
    // stale token after a long branch session.
    if (orgRefToken) {
      try {
        const refreshed = await refreshTokenApi(orgRefToken);
        activeOrgToken    = refreshed.token;
        activeOrgRefToken = refreshed.refreshToken;
      } catch {
        // HQ refresh token is invalid or expired — cannot restore HQ context safely.
        // Clear all auth state and require re-login.
        Object.values(KEYS).forEach(k => localStorage.removeItem(k));
        Object.values(ORG_KEYS).forEach(k => localStorage.removeItem(k));
        setState({ token: null, hotelId: null, hotelName: null, role: null, isAuthenticated: false, orgHotelId: null, orgHotelName: null });
        return;
      }
    }

    localStorage.setItem(KEYS.token,   activeOrgToken);
    if (activeOrgRefToken) localStorage.setItem(KEYS.refreshToken, activeOrgRefToken);
    else                   localStorage.removeItem(KEYS.refreshToken);
    localStorage.setItem(KEYS.hotelId,   orgHotelId);
    if (orgName) localStorage.setItem(KEYS.hotelName, orgName);

    Object.values(ORG_KEYS).forEach(k => localStorage.removeItem(k));

    setState(s => ({
      ...s,
      token:        activeOrgToken,
      hotelId:      orgHotelId,
      hotelName:    orgName,
      orgHotelId:   null,
      orgHotelName: null,
      isAuthenticated: true,
    }));
  }, []);

  const setHotelName = useCallback((name: string) => {
    localStorage.setItem(KEYS.hotelName, name);
    setState(s => ({ ...s, hotelName: name }));
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      login, loginCashier, loginSuperAdmin, logout, setHotelName,
      switchToBranch, switchToOrg,
      isInBranchContext: state.orgHotelId !== null,
    }),
    [state, login, loginCashier, loginSuperAdmin, logout, setHotelName, switchToBranch, switchToOrg],
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
