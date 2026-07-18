import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Settings } from '../types';
import { fetchSettings } from '../api/settings';
import { useAuth } from './AuthContext';

interface SettingsContextType {
  settings: Settings | null;
  loading: boolean;
  refresh(): Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, setHotelName } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchSettings();
      setSettings(s);
      if (s.hotelName) setHotelName(s.hotelName);
    } catch {
      // Settings fetch failure is non-fatal; app continues with defaults
    } finally {
      setLoading(false);
    }
  }, [setHotelName]);

  useEffect(() => {
    if (isAuthenticated) void refresh();
    else setSettings(null);
  }, [isAuthenticated, refresh]);

  return (
    <SettingsContext.Provider value={{ settings, loading, refresh }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be inside SettingsProvider');
  return ctx;
}
