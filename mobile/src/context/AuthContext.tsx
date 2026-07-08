import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveAuthCache, getAuthCache, clearAuthCache } from '../database/authDao';
import {
  clearToken,
  clearRefreshToken,
  validateSession,
  getJwtExpiryMs,
  tryRefreshTokens,
  logout as apiLogout,
} from '../services/api';
import { registerSessionExpiredHandler } from '../utils/authEvents';

// Persisted across restarts; cleared only on explicit logout.
const AUTH_KEY            = '@hotel_pos_logged_in';
const REMEMBER_DEVICE_KEY = '@dine_remember_device';

type AuthContextType = {
  isLoggedIn: boolean;
  isAuthLoading: boolean;
  isOfflineLogin: boolean;
  login: (jwt?: string, hotelId?: string, hotelName?: string, rememberDevice?: boolean) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  isLoggedIn: false,
  isAuthLoading: true,
  isOfflineLogin: false,
  login: async () => {},
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn]         = useState(false);
  const [isAuthLoading, setIsAuthLoading]   = useState(true);
  const [isOfflineLogin, setIsOfflineLogin] = useState(false);

  // Stable ref so authEvents can call logout without stale-closure issues.
  const logoutRef = useRef<() => Promise<void>>(async () => {});

  const logout = async () => {
    await AsyncStorage.multiRemove([AUTH_KEY, REMEMBER_DEVICE_KEY]);
    await apiLogout(); // fires server-side revocation + clears JWT/refresh in storage
    clearAuthCache();
    setIsOfflineLogin(false);
    setIsLoggedIn(false);
  };

  // Keep ref in sync so the session-expired handler always calls the latest closure.
  useEffect(() => { logoutRef.current = logout; });

  // ── On mount: register session-expired handler + validate stored session ──

  useEffect(() => {
    // Register the global handler BEFORE the async validation starts so any
    // SESSION_EXPIRED events fired during validation are caught.
    registerSessionExpiredHandler(() => logoutRef.current());

    (async () => {
      try {
        const flag = await AsyncStorage.getItem(AUTH_KEY);
        if (flag === 'true') {
          // Validate the stored JWT (expiry check, then refresh if needed).
          const status = await validateSession();
          if (status === 'valid' || status === 'refreshed') {
            const cache = getAuthCache();
            if (cache) setIsOfflineLogin(false);
            setIsLoggedIn(true);
          } else {
            // Both tokens expired — clear session flags but keep REMEMBER_DEVICE_KEY
            // so SplashScreen knows to route directly to AdminLogin instead of RoleSelect.
            await AsyncStorage.removeItem(AUTH_KEY);
            await Promise.all([clearToken(), clearRefreshToken()]);
            clearAuthCache();
          }
        }
      } catch {}
      setIsAuthLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Proactive refresh: renew JWT ~5 min before it expires ────────────────

  useEffect(() => {
    if (!isLoggedIn) return;
    let timerId: ReturnType<typeof setTimeout>;

    getJwtExpiryMs().then((expiryMs) => {
      if (!expiryMs) return;
      const delay = Math.max(0, expiryMs - 5 * 60 * 1000 - Date.now());
      timerId = setTimeout(() => {
        tryRefreshTokens().catch(() => {});
      }, delay);
    });

    return () => clearTimeout(timerId);
  }, [isLoggedIn]);

  // ── login / logout ────────────────────────────────────────────────────────

  const login = async (
    jwt?: string,
    hotelId?: string,
    hotelName?: string,
    rememberDevice: boolean = true,
  ) => {
    if (rememberDevice) {
      await AsyncStorage.multiSet([
        [AUTH_KEY, 'true'],
        [REMEMBER_DEVICE_KEY, 'true'],
      ]);
    }
    if (jwt && hotelId && hotelName) {
      saveAuthCache(jwt, hotelId, hotelName);
    }
    setIsOfflineLogin(false);
    setIsLoggedIn(true);
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, isAuthLoading, isOfflineLogin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

// Kept for backward-compat with any call sites that still import this directly.
export const cacheLoginCredentials = (jwt: string, hotelId: string, hotelName: string) => {
  saveAuthCache(jwt, hotelId, hotelName);
};
