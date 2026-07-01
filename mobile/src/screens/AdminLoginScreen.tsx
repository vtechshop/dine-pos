import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { showAlert } from '../utils/alert';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';
import { adminLogin, getSettings, requestCredentialReset, checkResetStatus } from '../services/api';
import { useAuth } from '../context/AuthContext';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminLogin'>;

const AdminLoginScreen: React.FC<Props> = ({ navigation }) => {
  const { login } = useAuth();
  const [userId, setUserId]     = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [userFocus, setUserFocus] = useState(false);
  const [passFocus, setPassFocus] = useState(false);

  const [forgotModal, setForgotModal]     = useState(false);
  const [forgotStep, setForgotStep]       = useState<'input' | 'sent' | 'done'>('input');
  const [forgotPhone, setForgotPhone]     = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [resetAdminId, setResetAdminId]   = useState('');

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const shake = () => Animated.sequence([
    Animated.timing(shakeAnim, { toValue: 10,  duration: 60, useNativeDriver: true }),
    Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
    Animated.timing(shakeAnim, { toValue: 8,   duration: 60, useNativeDriver: true }),
    Animated.timing(shakeAnim, { toValue: -8,  duration: 60, useNativeDriver: true }),
    Animated.timing(shakeAnim, { toValue: 0,   duration: 60, useNativeDriver: true }),
  ]).start();

  const handleLogin = async () => {
    if (!userId.trim() || !password.trim()) { showAlert('Missing', 'Enter User ID and Password'); return; }
    setLoading(true);
    try {
      const result = await adminLogin(userId.trim(), password.trim());
      const s = await getSettings();
      if (!s.isSetupComplete) { navigation.replace('BusinessSetup', undefined); return; }
      // Cache JWT + hotelId + hotelName in SQLite for offline login
      await login(result.token, result.hotelId, result.hotelName);
    } catch (error: any) {
      const msg = error.message || '';
      if (msg.toLowerCase().includes('suspended')) { navigation.replace('HotelStatus', { status: 'suspended', hotelName: '' }); return; }
      shake();
      showAlert('Login Failed', msg || 'Invalid credentials');
    } finally { setLoading(false); }
  };

  const openForgot = () => { setForgotStep('input'); setForgotPhone(''); setResetAdminId(''); setForgotModal(true); };

  const handleSendReset = async () => {
    if (forgotPhone.trim().length !== 10) { showAlert('Error', 'Enter a valid 10-digit phone'); return; }
    setForgotLoading(true);
    try { await requestCredentialReset(forgotPhone.trim()); setForgotStep('sent'); }
    catch (e: any) { showAlert('Error', e.message); }
    finally { setForgotLoading(false); }
  };

  const handleCheckReset = async () => {
    setForgotLoading(true);
    try {
      const r = await checkResetStatus(forgotPhone.trim());
      if (r.resetFulfilledAt) { setResetAdminId(r.adminId || ''); setForgotStep('done'); }
      else showAlert('Pending', 'Not updated yet. Try again later.');
    } catch (e: any) { showAlert('Error', e.message); }
    finally { setForgotLoading(false); }
  };

  const forgotContent = () => {
    if (forgotStep === 'input') return (
      <>
        <Text style={styles.modalTitle}>Reset Credentials</Text>
        <Text style={styles.modalDesc}>Enter your registered phone number. We'll notify the admin.</Text>
        <View style={styles.modalInput}>
          <MaterialIcons name="phone" size={20} color={Colors.textSecondary} />
          <TextInput style={styles.modalInputText} placeholder="10-digit phone" placeholderTextColor={Colors.textMuted} value={forgotPhone} onChangeText={setForgotPhone} keyboardType="phone-pad" maxLength={10} />
        </View>
        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.btnOutline} onPress={() => setForgotModal(false)}>
            <Text style={styles.btnOutlineTxt}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnFilled} onPress={handleSendReset} disabled={forgotLoading}>
            {forgotLoading ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.btnFilledTxt}>Send Request</Text>}
          </TouchableOpacity>
        </View>
      </>
    );
    if (forgotStep === 'sent') return (
      <>
        <View style={styles.modalIconWrap}><MaterialIcons name="mark-email-read" size={52} color={Colors.success} /></View>
        <Text style={styles.modalTitle}>Request Sent!</Text>
        <Text style={styles.modalDesc}>The admin will update your credentials. Tap Check Status when ready.</Text>
        <TouchableOpacity style={[styles.btnFilled, { marginTop: Spacing.lg }]} onPress={handleCheckReset} disabled={forgotLoading}>
          {forgotLoading ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.btnFilledTxt}>Check Status</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btnOutline, { marginTop: Spacing.sm }]} onPress={() => setForgotModal(false)}>
          <Text style={styles.btnOutlineTxt}>Close</Text>
        </TouchableOpacity>
      </>
    );
    return (
      <>
        <View style={styles.modalIconWrap}><MaterialIcons name="check-circle" size={52} color={Colors.success} /></View>
        <Text style={styles.modalTitle}>Credentials Ready!</Text>
        <View style={styles.credBox}>
          <Text style={styles.credLabel}>Your Admin ID</Text>
          <Text style={styles.credValue}>{resetAdminId}</Text>
          <Text style={styles.credNote}>Contact admin for your new password.</Text>
        </View>
        <TouchableOpacity style={styles.btnFilled} onPress={() => { setUserId(resetAdminId); setForgotModal(false); }}>
          <Text style={styles.btnFilledTxt}>Use This ID</Text>
        </TouchableOpacity>
      </>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Forgot Modal */}
      <Modal visible={forgotModal} transparent animationType="fade" onRequestClose={() => setForgotModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>{forgotContent()}</View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Top banner */}
        <View style={styles.topBanner}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.replace('RoleSelect')}>
            <MaterialIcons name="arrow-back" size={22} color={Colors.white} />
          </TouchableOpacity>
          <Text style={styles.bannerTitle}>Staff Login</Text>
        </View>

        {/* Icon */}
        <View style={styles.iconSection}>
          <View style={styles.iconCircle}>
            <Text style={{ fontSize: 52 }}>💼</Text>
          </View>
          <Text style={styles.title}>Welcome Back!</Text>
          <Text style={styles.subtitle}>Enter your POS credentials to continue</Text>
        </View>

        {/* Form card */}
        <Animated.View style={[styles.formCard, { transform: [{ translateX: shakeAnim }] }]}>
          <View style={[styles.inputWrap, userFocus && styles.inputFocused]}>
            <MaterialIcons name="badge" size={20} color={userFocus ? Colors.primary : Colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="User ID"
              placeholderTextColor={Colors.textMuted}
              value={userId}
              onChangeText={setUserId}
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setUserFocus(true)}
              onBlur={() => setUserFocus(false)}
            />
          </View>

          <View style={[styles.inputWrap, passFocus && styles.inputFocused]}>
            <MaterialIcons name="lock-outline" size={20} color={passFocus ? Colors.primary : Colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              onFocus={() => setPassFocus(true)}
              onBlur={() => setPassFocus(false)}
            />
            <TouchableOpacity onPress={() => setShowPass(!showPass)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name={showPass ? 'visibility' : 'visibility-off'} size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.loginBtn, loading && { opacity: 0.7 }]} onPress={handleLogin} activeOpacity={0.85} disabled={loading}>
            {loading
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <><Text style={styles.loginBtnText}>Sign In</Text><MaterialIcons name="arrow-forward" size={20} color={Colors.white} /></>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.forgotRow} onPress={openForgot}>
            <MaterialIcons name="help-outline" size={15} color={Colors.textMuted} />
            <Text style={styles.forgotText}>Forgot your password?</Text>
          </TouchableOpacity>
        </Animated.View>

        <TouchableOpacity style={styles.registerRow} onPress={() => navigation.navigate('BusinessSetup', { resubmit: false })}>
          <Text style={styles.registerText}>New hotel? </Text>
          <Text style={[styles.registerText, { color: Colors.primary, fontWeight: '800' }]}>Register here →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: Colors.background },
  topBanner: {
    backgroundColor: Colors.primary, paddingTop: 52, paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.xl, flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.white },
  iconSection: { alignItems: 'center', paddingTop: Spacing.xxl, paddingBottom: Spacing.xl },
  iconCircle: { width: 100, height: 100, borderRadius: 28, backgroundColor: Colors.accentBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg, borderWidth: 2, borderColor: Colors.accent + '40', ...Shadows.md },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  subtitle: { fontSize: FontSize.md, color: Colors.textSecondary },
  formCard: { backgroundColor: Colors.surface, marginHorizontal: Spacing.xl, borderRadius: BorderRadius.xxl, padding: Spacing.xl, borderWidth: 1.5, borderColor: Colors.border, gap: Spacing.md, ...Shadows.md },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.lg, borderWidth: 1.5, borderColor: Colors.border, gap: Spacing.sm },
  inputFocused: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  input: { flex: 1, paddingVertical: 15, fontSize: FontSize.lg, color: Colors.text },
  loginBtn: { flexDirection: 'row', backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: BorderRadius.lg, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, ...Shadows.primary },
  loginBtnText: { color: Colors.white, fontSize: FontSize.xl, fontWeight: '800' },
  forgotRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: Spacing.sm },
  forgotText: { color: Colors.textMuted, fontSize: FontSize.md },
  registerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.xl, paddingBottom: Spacing.xxl },
  registerText: { fontSize: FontSize.md, color: Colors.textSecondary },
  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', alignItems: 'center', padding: Spacing.xxl },
  modal: { backgroundColor: Colors.surface, borderRadius: BorderRadius.xxl, padding: Spacing.xxl, width: '100%', borderWidth: 1.5, borderColor: Colors.border, ...Shadows.lg },
  modalTitle: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800', textAlign: 'center', marginBottom: Spacing.sm },
  modalDesc: { color: Colors.textSecondary, fontSize: FontSize.md, textAlign: 'center', marginBottom: Spacing.xl, lineHeight: 22 },
  modalIconWrap: { alignItems: 'center', marginBottom: Spacing.lg },
  modalInput: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background, borderRadius: BorderRadius.md, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: Spacing.lg, marginBottom: Spacing.xl, gap: Spacing.sm },
  modalInputText: { flex: 1, color: Colors.text, fontSize: FontSize.lg, paddingVertical: Spacing.lg },
  modalActions: { flexDirection: 'row', gap: Spacing.md },
  btnOutline: { flex: 1, paddingVertical: 13, borderRadius: BorderRadius.md, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  btnOutlineTxt: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '600' },
  btnFilled: { flex: 1, paddingVertical: 13, borderRadius: BorderRadius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  btnFilledTxt: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },
  credBox: { backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: Spacing.lg, marginBottom: Spacing.xl, alignItems: 'center' },
  credLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: 4 },
  credValue: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800', marginBottom: 6 },
  credNote: { color: Colors.textMuted, fontSize: FontSize.sm, textAlign: 'center' },
});

export default AdminLoginScreen;
