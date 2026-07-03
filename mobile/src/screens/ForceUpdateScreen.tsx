import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ForceUpdate'>;

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.vtechshop.dinepos';

export default function ForceUpdateScreen({ route }: Props) {
  const { minimumVersion, message } = route.params;

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🚀</Text>
      <Text style={styles.title}>Update Required</Text>
      <Text style={styles.subtitle}>Version {minimumVersion} or higher is required</Text>
      <Text style={styles.body}>
        {message || 'A new version of Dine POS is available with important improvements. Please update to continue.'}
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => Linking.openURL(PLAY_STORE_URL)}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>Update Now</Text>
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
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#7A4F3A',
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
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
