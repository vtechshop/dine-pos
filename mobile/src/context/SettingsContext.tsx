import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Settings } from '../types';
import * as api from '../services/api';

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
  const [loading, setLoading] = useState(true);

  const refreshSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);
    } catch (error) {
      console.log('Using default settings (server unavailable)');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (data: Partial<Settings>) => {
    try {
      const updated = await api.updateSettings(data);
      setSettings(updated);
    } catch (error) {
      throw error;
    }
  };

  useEffect(() => {
    refreshSettings();
  }, []);

  return (
    <SettingsContext.Provider
      value={{ settings, loading, refreshSettings, saveSettings }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextType => {
  const context = useContext(SettingsContext);
  if (!context)
    throw new Error('useSettings must be used within SettingsProvider');
  return context;
};
