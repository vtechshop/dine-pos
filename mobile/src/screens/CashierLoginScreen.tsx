import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { cashierLogin, saveCashierToken, getStoredHotelId } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CASHIER_PROFILE_KEY = '@hotel_pos_cashier_profile';

type Props = NativeStackScreenProps<RootStackParamList, 'CashierLogin'>;

const CashierLoginScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();
  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pinRef = useRef<TextInput>(null);

  const handleLogin = async () => {
    if (!employeeCode.trim()) { setError('Enter your employee code'); return; }
    if (pin.length < 4)       { setError('Enter your 4–6 digit PIN'); return; }
    setError('');
    setLoading(true);
    try {
      const hotelId = await getStoredHotelId();
      if (!hotelId) {
        setError('Hotel not found. Ask admin to set up the device first.');
        return;
      }
      const { token, cashier } = await cashierLogin(hotelId, employeeCode.trim().toUpperCase(), pin);
      await saveCashierToken(token);
      await AsyncStorage.setItem(CASHIER_PROFILE_KEY, JSON.stringify(cashier));
      navigation.replace('CashierDashboard');
    } catch (e: any) {
      setError(e.message || 'Login failed. Check your code and PIN.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: top, paddingBottom: bottom + Spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Text style={{ fontSize: 52 }}>💰</Text>
          </View>

          <Text style={styles.title}>Cashier Login</Text>
          <Text style={styles.subtitle}>Enter your employee code and PIN</Text>

          <View style={styles.inputCard}>
            <View style={[styles.inputWrap, error && !pin ? styles.inputError : null]}>
              <MaterialIcons name="badge" size={20} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Employee Code (e.g. C001)"
                placeholderTextColor={Colors.textMuted}
                value={employeeCode}
                onChangeText={v => { setEmployeeCode(v.toUpperCase()); setError(''); }}
                autoCapitalize="characters"
                returnKeyType="next"
                onSubmitEditing={() => pinRef.current?.focus()}
                autoFocus
              />
            </View>

            <View style={[styles.inputWrap, { marginTop: Spacing.md }, error && pin.length < 4 ? styles.inputError : null]}>
              <MaterialIcons name="lock-outline" size={20} color={Colors.textMuted} />
              <TextInput
                ref={pinRef}
                style={[styles.input, { letterSpacing: 4 }]}
                placeholder="PIN"
                placeholderTextColor={Colors.textMuted}
                value={pin}
                onChangeText={v => { setPin(v.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                onSubmitEditing={handleLogin}
              />
            </View>

            {!!error && (
              <View style={styles.errorRow}>
                <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.loginBtn, (loading || !employeeCode.trim() || pin.length < 4) && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading || !employeeCode.trim() || pin.length < 4}
            activeOpacity={0.88}
          >
            {loading
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <>
                  <MaterialIcons name="point-of-sale" size={20} color={Colors.white} />
                  <Text style={styles.loginBtnText}>Open Cashier Screen</Text>
                </>
            }
          </TouchableOpacity>

          <Text style={styles.hint}>
            Ask your admin to create your cashier account{'\n'}in Settings → Manage Cashiers
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingBottom: 40 },
  iconWrap: {
    width: 100, height: 100, borderRadius: 28,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.border, marginBottom: Spacing.xl, ...Shadows.sm,
  },
  title:    { fontSize: FontSize.xxxl, fontWeight: '900', color: Colors.text, marginBottom: Spacing.sm },
  subtitle: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xxl },
  inputCard: { width: '100%', marginBottom: Spacing.xl },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg, borderWidth: 1.5, borderColor: Colors.border, ...Shadows.sm,
  },
  inputError: { borderColor: Colors.danger },
  input: { flex: 1, paddingVertical: 16, fontSize: FontSize.xl, color: Colors.text, fontWeight: '700' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, paddingLeft: 4 },
  errorText: { color: Colors.danger, fontSize: FontSize.sm },
  loginBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, backgroundColor: Colors.info, borderRadius: BorderRadius.xl,
    paddingVertical: 16, ...Shadows.sm,
  },
  loginBtnDisabled: { opacity: 0.5 },
  loginBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
  hint: { marginTop: Spacing.xl, fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
});

export default CashierLoginScreen;
