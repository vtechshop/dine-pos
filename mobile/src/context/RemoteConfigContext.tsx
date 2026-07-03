import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RemoteConfig } from '../types';
import { getRemoteConfig } from '../services/api';

const STORAGE_KEY = '@dine_remote_config';

const DEFAULT_CONFIG: RemoteConfig = {
  maintenanceMode: false,
  maintenanceMessage: '',
  minimumAppVersion: '1.0.0',
  minimumAppVersionIos: '1.0.0',
  forceUpdate: false,
  forceUpdateMessage: '',
  trialDays: 14,
  paymentEnabled: false,
  broadcastMessage: '',
  broadcastMessageType: 'info',
};

interface RemoteConfigContextValue {
  config: RemoteConfig;
  loading: boolean;
  refresh: () => Promise<void>;
}

const RemoteConfigContext = createContext<RemoteConfigContextValue>({
  config: DEFAULT_CONFIG,
  loading: true,
  refresh: async () => {},
});

export const useRemoteConfig = () => useContext(RemoteConfigContext);

export const RemoteConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<RemoteConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const fresh = await getRemoteConfig();
      setConfig(fresh);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // On network failure, fall back to cached config
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEY);
        if (cached) setConfig(JSON.parse(cached));
      } catch {
        // Use defaults — never block the app
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load cached config immediately so there's no flash, then fetch fresh
    AsyncStorage.getItem(STORAGE_KEY).then((cached) => {
      if (cached) {
        try { setConfig(JSON.parse(cached)); } catch {}
      }
    });
    refresh();
  }, [refresh]);

  return (
    <RemoteConfigContext.Provider value={{ config, loading, refresh }}>
      {children}
    </RemoteConfigContext.Provider>
  );
};
