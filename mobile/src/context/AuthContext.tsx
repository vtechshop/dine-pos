import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveAuthCache, getAuthCache, clearAuthCache } from '../database/authDao';
import { saveToken, clearToken } from '../services/api';

const AUTH_KEY = '@hotel_pos_logged_in';

type AuthContextType = {
  isLoggedIn: boolean;
  isAuthLoading: boolean;
  isOfflineLogin: boolean;
  login: (jwt?: string, hotelId?: string, hotelName?: string) => Promise<void>;
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
  const [isLoggedIn, setIsLoggedIn]       = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isOfflineLogin, setIsOfflineLogin] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const flag = await AsyncStorage.getItem(AUTH_KEY);
        if (flag === 'true') {
          setIsLoggedIn(true);
          // Detect if we booted offline but have a cached JWT
          const cache = getAuthCache();
          if (cache) setIsOfflineLogin(false); // will be set by SyncContext later
        }
      } catch {}
      setIsAuthLoading(false);
    })();
  }, []);

  // Called after successful online login — caches JWT in SQLite for offline use
  const login = async (jwt?: string, hotelId?: string, hotelName?: string) => {
    await AsyncStorage.setItem(AUTH_KEY, 'true');
    if (jwt && hotelId && hotelName) {
      saveAuthCache(jwt, hotelId, hotelName);
    }
    setIsOfflineLogin(false);
    setIsLoggedIn(true);
  };

  const logout = async () => {
    await AsyncStorage.removeItem(AUTH_KEY);
    await clearToken();
    clearAuthCache();
    setIsOfflineLogin(false);
    setIsLoggedIn(false);
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, isAuthLoading, isOfflineLogin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

// Called from AdminLoginScreen on successful login so JWT is cached
export const cacheLoginCredentials = (jwt: string, hotelId: string, hotelName: string) => {
  saveAuthCache(jwt, hotelId, hotelName);
};
