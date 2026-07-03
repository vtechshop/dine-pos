import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { kitchenLogin, saveKitchenToken, getStoredHotelId } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'KitchenLogin'>;

const KitchenLoginScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pinRef = useRef<TextInput>(null);

  const handleLogin = async () => {
    if (pin.length < 4) { setError('Enter the 4-digit kitchen PIN'); return; }
    setError('');
    setLoading(true);
    try {
      const hotelId = await getStoredHotelId();
      if (!hotelId) {
        setError('Hotel not found. Please ask admin to set up the device first.');
        return;
      }
      const token = await kitchenLogin(hotelId, pin);
      await saveKitchenToken(token);
      navigation.replace('KitchenDisplay');
    } catch (e: any) {
      setError(e.message || 'Login failed. Check PIN and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePinChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 6);
    setPin(digits);
    setError('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: top }]}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            <Text style={{ fontSize: 52 }}>👨‍🍳</Text>
          </View>

          <Text style={styles.title}>Kitchen Display</Text>
          <Text style={styles.subtitle}>Enter the kitchen PIN set by your admin</Text>

          {/* PIN input */}
          <View style={styles.inputCard}>
            <View style={[styles.inputWrap, error ? styles.inputError : null]}>
              <MaterialIcons name="lock-outline" size={20} color={error ? Colors.danger : Colors.textMuted} />
              <TextInput
                ref={pinRef}
                style={styles.input}
                placeholder="Kitchen PIN"
                placeholderTextColor={Colors.textMuted}
                value={pin}
                onChangeText={handlePinChange}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                onSubmitEditing={handleLogin}
                autoFocus
              />
            </View>
            {!!error && (
              <View style={styles.errorRow}>
                <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </View>

          {/* Login button */}
          <TouchableOpacity
            style={[styles.loginBtn, (loading || pin.length < 4) && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading || pin.length < 4}
            activeOpacity={0.88}
          >
            {loading
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <>
                  <MaterialIcons name="restaurant" size={20} color={Colors.white} />
                  <Text style={styles.loginBtnText}>Open Kitchen Display</Text>
                </>
            }
          </TouchableOpacity>

          <Text style={styles.hint}>
            PIN is set by your admin in{'\n'}Settings → Kitchen PIN
          </Text>
        </View>

        <View style={{ paddingBottom: bottom + Spacing.md }} />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  body: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xl, paddingBottom: 60,
  },
  iconWrap: {
    width: 100, height: 100, borderRadius: 28,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.border, marginBottom: Spacing.xl,
    ...Shadows.sm,
  },
  title: { fontSize: FontSize.xxxl, fontWeight: '900', color: Colors.text, marginBottom: Spacing.sm },
  subtitle: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xxl },
  inputCard: { width: '100%', marginBottom: Spacing.xl },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg, borderWidth: 1.5, borderColor: Colors.border,
    ...Shadows.sm,
  },
  inputError: { borderColor: Colors.danger },
  input: {
    flex: 1, paddingVertical: 16, fontSize: FontSize.xl,
    color: Colors.text, letterSpacing: 4, fontWeight: '700',
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, paddingLeft: 4 },
  errorText: { color: Colors.danger, fontSize: FontSize.sm },
  loginBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: BorderRadius.xl,
    paddingVertical: 16, ...Shadows.primary,
  },
  loginBtnDisabled: { opacity: 0.5 },
  loginBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
  hint: {
    marginTop: Spacing.xl, fontSize: FontSize.sm, color: Colors.textMuted,
    textAlign: 'center', lineHeight: 20,
  },
});

export default KitchenLoginScreen;
