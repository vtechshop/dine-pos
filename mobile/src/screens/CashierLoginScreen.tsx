import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform,
  ScrollView, Animated, Easing,
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

const DARK_BG  = '#020E22';
const ACCENT   = Colors.info;
const ACCENT20 = Colors.info + '20';
const ACCENT55 = Colors.info + '55';

const CashierLoginScreen: React.FC<Props> = ({ navigation }) => {
  const { bottom } = useSafeAreaInsets();
  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin]                   = useState('');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const pinRef = useRef<TextInput>(null);

  const sheetAnim = useRef(new Animated.Value(48)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(sheetAnim, { toValue: 0, duration: 420, delay: 80, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();
  }, []);

  const handleLogin = async () => {
    if (!employeeCode.trim()) { setError('Enter your employee code'); return; }
    if (pin.length < 4)       { setError('Enter your 4–6 digit PIN'); return; }
    setError('');
    setLoading(true);
    try {
      const hotelId = await getStoredHotelId();
      if (!hotelId) { setError('Hotel not found. Ask admin to set up this device.'); return; }
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

  const canSubmit = employeeCode.trim().length > 0 && pin.length >= 4;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.root, { backgroundColor: DARK_BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={DARK_BG} />

        {/* ── Dark header ───────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: Spacing.md }]}>
          <View style={styles.orb} />

          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <MaterialIcons name="arrow-back" size={20} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>

          <Animated.View style={[styles.headerContent, { opacity: fadeAnim }]}>
            <View style={[styles.iconRing, { borderColor: ACCENT55, backgroundColor: ACCENT20 }]}>
              <MaterialIcons name="point-of-sale" size={34} color={ACCENT} />
            </View>
            <Text style={styles.headerTitle}>Cashier Login</Text>
            <Text style={styles.headerSub}>Enter your credentials to continue</Text>
          </Animated.View>
        </View>

        {/* ── White sheet ───────────────────────────────────────────────── */}
        <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetAnim }] }]}>
          <View style={styles.sheetHandle} />

          <ScrollView
            contentContainerStyle={[styles.formScroll, { paddingBottom: bottom + Spacing.xl }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.fieldLabel}>EMPLOYEE CODE</Text>
            <View style={[styles.inputRow, { marginBottom: Spacing.md }]}>
              <MaterialIcons name="badge" size={20} color={Colors.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="e.g. C001"
                placeholderTextColor={Colors.textMuted}
                value={employeeCode}
                onChangeText={v => { setEmployeeCode(v.toUpperCase()); setError(''); }}
                autoCapitalize="characters"
                returnKeyType="next"
                onSubmitEditing={() => pinRef.current?.focus()}
                autoFocus
              />
            </View>

            <Text style={styles.fieldLabel}>PIN</Text>
            <View style={[styles.inputRow, { marginBottom: Spacing.sm }]}>
              <MaterialIcons name="lock-outline" size={20} color={Colors.textMuted} />
              <TextInput
                ref={pinRef}
                style={[styles.input, { letterSpacing: 6 }]}
                placeholder="• • • •"
                placeholderTextColor={Colors.textMuted}
                value={pin}
                onChangeText={v => { setPin(v.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                onSubmitEditing={handleLogin}
              />
              {pin.length > 0 && (
                <TouchableOpacity onPress={() => { setPin(''); setError(''); }}>
                  <MaterialIcons name="close" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {!!error && (
              <View style={styles.errorRow}>
                <MaterialIcons name="error-outline" size={14} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.loginBtn, { backgroundColor: ACCENT }, (!canSubmit || loading) && styles.loginBtnDisabled]}
              onPress={handleLogin}
              disabled={!canSubmit || loading}
              activeOpacity={0.88}
            >
              {loading ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <MaterialIcons name="point-of-sale" size={20} color={Colors.white} />
                  <Text style={styles.loginBtnText}>Open Cashier Screen</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.hint}>
              Ask your admin to create your cashier account{'\n'}in Settings → Manage Cashiers
            </Text>
          </ScrollView>
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flex: 1,
    overflow: 'hidden',
    paddingBottom: Spacing.xxl,
  },
  orb: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: Colors.info + '14',
    top: -70,
    right: -50,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  headerContent: {
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  headerTitle: {
    fontSize: FontSize.xxxl,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxxl,
    borderTopRightRadius: BorderRadius.xxxl,
    paddingTop: Spacing.md,
    ...Shadows.lg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.xl,
  },
  formScroll: {
    paddingHorizontal: Spacing.xl,
  },
  fieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: FontSize.lg,
    color: Colors.text,
    fontWeight: '600',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: Spacing.md,
  },
  errorText: { color: Colors.danger, fontSize: FontSize.sm },
  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: BorderRadius.lg,
    paddingVertical: 16,
    marginTop: Spacing.md,
    shadowColor: Colors.info,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 8,
  },
  loginBtnDisabled: { opacity: 0.4 },
  loginBtnText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  hint: {
    marginTop: Spacing.xl,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default CashierLoginScreen;
