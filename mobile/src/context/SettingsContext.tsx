import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Settings } from '../types';
import * as api from '../services/api';

const SETTINGS_CACHE_KEY = '@hotel_pos_settings_cache';

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
      // Load cached settings first so UI is instant even if backend is sleeping
      const cached = await AsyncStorage.getItem(SETTINGS_CACHE_KEY);
      if (cached) setSettings({ ...defaultSettings, ...JSON.parse(cached) });
    } catch {}

    try {
      const data = await api.getSettings();
      setSettings(data);
      // Update cache with latest from server
      await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(data));
    } catch {
      console.log('Using cached/default settings (server unavailable)');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (data: Partial<Settings>) => {
    try {
      const updated = await api.updateSettings(data);
      setSettings(updated);
      // Keep cache in sync
      await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(updated));
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
