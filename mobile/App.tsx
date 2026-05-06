import React from 'react';
import { StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AuthProvider>
          <SettingsProvider>
            <CartProvider>
              <StatusBar style="dark" />
              <AppNavigator />
            </CartProvider>
          </SettingsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
