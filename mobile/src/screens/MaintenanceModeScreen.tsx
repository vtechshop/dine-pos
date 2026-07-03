import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useRemoteConfig } from '../context/RemoteConfigContext';

type Props = NativeStackScreenProps<RootStackParamList, 'MaintenanceMode'>;

export default function MaintenanceModeScreen({ navigation, route }: Props) {
  const { message } = route.params;
  const { refresh } = useRemoteConfig();
  const [checking, setChecking] = useState(false);

  const checkAgain = async () => {
    setChecking(true);
    try {
      await refresh();
      // RemoteConfigContext will trigger re-check in SplashScreen if we go back
      navigation.replace('Splash');
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔧</Text>
      <Text style={styles.title}>Under Maintenance</Text>
      <Text style={styles.body}>
        {message || 'Dine POS is undergoing scheduled maintenance. We will be back shortly. Thank you for your patience.'}
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={checkAgain}
        activeOpacity={0.8}
        disabled={checking}
      >
        {checking ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.buttonText}>Check Again</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF6EE',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  icon: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1C0800',
    marginBottom: 16,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#4A2B1A',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  button: {
    backgroundColor: '#E8380D',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    minWidth: 160,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
