import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Settings } from '../types';
import * as api from '../services/api';
import { getLocalSettings, saveLocalSettings } from '../database/localCacheDao';

interface SettingsContextType {
  settings: Settings;
  loading: boolean;
  refreshSettings: () => Promise<void>;
  saveSettings: (data: Partial<Settings>) => Promise<void>;
}

const defaultSettings: Settings = {
  hotelName: 'My Hotel',
  address: '',
  phone: '',
  email: '',
  ownerName: '',
  fssaiNumber: '',
  panNumber: '',
  businessType: 'both',
  bankName: '',
  bankAccountNumber: '',
  bankIfscCode: '',
  bankAccountHolder: '',
  upiId: '',
  gstNumber: '',
  defaultTaxPercent: 5,
  currency: 'INR',
  currencySymbol: '₹',
  printerWidth: '58mm',
  footerText: 'Thank you! Visit again!',
  isSetupComplete: false,
};

const SettingsContext = createContext<SettingsContextType | null>(null);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading]   = useState(true);

  const refreshSettings = useCallback(async () => {
    // 1. Load SQLite cache first (instant, works offline)
    const cached = getLocalSettings();
    if (cached) setSettings({ ...defaultSettings, ...cached });

    // 2. Try to fetch fresh data from MongoDB via API
    try {
      const data = await api.getSettings();
      setSettings(data);
      saveLocalSettings(data);
    } catch {
      // Offline — keep SQLite cache; already set above
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (data: Partial<Settings>) => {
    const updated = await api.updateSettings(data);
    setSettings(updated);
    saveLocalSettings(updated);
  }, []);

  useEffect(() => { refreshSettings(); }, [refreshSettings]);

  return (
    <SettingsContext.Provider value={{ settings, loading, refreshSettings, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextType => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
};
