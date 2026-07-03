import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FeatureFlags } from '../types';

const STORAGE_KEY = '@dine_feature_flags';

const DEFAULT_FLAGS: FeatureFlags = {
  payment: false,
  reservations: true,
  customerChat: true,
  qrOrdering: true,
  expenses: true,
  reports: true,
  tables: true,
  ingredients: false,
  waste: false,
  aggregator: false,
};

interface FeatureFlagsContextValue {
  flags: FeatureFlags;
  setFlags: (flags: FeatureFlags) => Promise<void>;
  resetFlags: () => Promise<void>;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  flags: DEFAULT_FLAGS,
  setFlags: async () => {},
  resetFlags: async () => {},
});

export const useFeatureFlags = () => useContext(FeatureFlagsContext);

export const FeatureFlagsProvider = ({ children }: { children: ReactNode }) => {
  const [flags, setFlagsState] = useState<FeatureFlags>(DEFAULT_FLAGS);

  // Called once after login with the hotel's feature flags from the login response
  const setFlags = useCallback(async (newFlags: FeatureFlags) => {
    const merged = { ...DEFAULT_FLAGS, ...newFlags };
    setFlagsState(merged);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {}
  }, []);

  const resetFlags = useCallback(async () => {
    setFlagsState(DEFAULT_FLAGS);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  // Rehydrate on mount from AsyncStorage (persists across app restarts)
  React.useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored) {
        try { setFlagsState({ ...DEFAULT_FLAGS, ...JSON.parse(stored) }); } catch {}
      }
    });
  }, []);

  return (
    <FeatureFlagsContext.Provider value={{ flags, setFlags, resetFlags }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
};
