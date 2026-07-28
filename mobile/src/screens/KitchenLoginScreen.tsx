import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform,
  Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { kitchenLogin, saveKitchenToken, getStoredHotelId } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'KitchenLogin'>;

const DARK_BG  = '#041409';
const ACCENT   = Colors.success;
const ACCENT20 = Colors.success + '20';
const ACCENT55 = Colors.success + '55';

const KitchenLoginScreen: React.FC<Props> = ({ navigation }) => {
  const { top, bottom } = useSafeAreaInsets();
  const [pin, setPin]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
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
    if (pin.length < 4) { setError('Enter the 4-digit kitchen PIN'); return; }
    setError('');
    setLoading(true);
    try {
      const hotelId = await getStoredHotelId();
      if (!hotelId) { setError('Hotel not found. Ask admin to set up this device.'); return; }
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
    setPin(val.replace(/\D/g, '').slice(0, 6));
    setError('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.root, { backgroundColor: DARK_BG }]}>
        <StatusBar barStyle="light-content" backgroundColor={DARK_BG} />

        {/* ── Dark header ───────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: top + Spacing.md }]}>
          <View style={styles.orb} />

          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <MaterialIcons name="arrow-back" size={20} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>

          <Animated.View style={[styles.headerContent, { opacity: fadeAnim }]}>
            <View style={[styles.iconRing, { borderColor: ACCENT55, backgroundColor: ACCENT20 }]}>
              <MaterialIcons name="restaurant" size={34} color={ACCENT} />
            </View>
            <Text style={styles.headerTitle}>Kitchen Display</Text>
            <Text style={styles.headerSub}>Enter kitchen PIN to continue</Text>
          </Animated.View>
        </View>

        {/* ── White sheet ───────────────────────────────────────────────── */}
        <Animated.View style={[styles.sheet, { paddingBottom: bottom + Spacing.xl, transform: [{ translateY: sheetAnim }] }]}>
          <View style={styles.sheetHandle} />

          <Text style={styles.fieldLabel}>KITCHEN PIN</Text>
          <View style={[styles.inputRow, error ? styles.inputRowError : { borderColor: Colors.border }]}>
            <MaterialIcons name="lock-outline" size={20} color={error ? Colors.danger : Colors.textMuted} />
            <TextInput
              ref={pinRef}
              style={styles.input}
              placeholder="• • • •"
              placeholderTextColor={Colors.textMuted}
              value={pin}
              onChangeText={handlePinChange}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              onSubmitEditing={handleLogin}
              autoFocus
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
            style={[styles.loginBtn, { backgroundColor: ACCENT }, (loading || pin.length < 4) && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading || pin.length < 4}
            activeOpacity={0.88}
          >
            {loading ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <MaterialIcons name="restaurant" size={20} color={Colors.white} />
                <Text style={styles.loginBtnText}>Open Kitchen Display</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            PIN is set by your admin in{'\n'}Settings → Kitchen PIN
          </Text>
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
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: Colors.success + '14',
    top: -80,
    right: -60,
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
    paddingHorizontal: Spacing.xl,
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
    marginBottom: Spacing.sm,
  },
  inputRowError: { borderColor: Colors.danger },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: FontSize.xl,
    color: Colors.text,
    letterSpacing: 6,
    fontWeight: '700',
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
    ...Shadows.success,
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
    paddingBottom: Spacing.sm,
  },
});

export default KitchenLoginScreen;
