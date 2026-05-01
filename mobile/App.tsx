import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { CartProvider } from './src/context/CartContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { AuthProvider } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';

// Suppress benign Expo keep-awake native errors during screen transitions
const EU = (global as any).ErrorUtils;
if (EU) {
  const originalHandler = EU.getGlobalHandler?.();
  EU.setGlobalHandler?.((error: Error, isFatal: boolean) => {
    if (error?.message?.includes('ExpoKeepAwake')) return;
    originalHandler?.(error, isFatal);
  });
}

export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <CartProvider>
          <StatusBar style="light" />
          <AppNavigator />
        </CartProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
