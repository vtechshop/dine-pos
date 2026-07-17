import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Switch,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, BusinessType } from '../types';
import { showAlert } from '../utils/alert';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { registerHotel, resubmitHotel, verifyPincode, verifyGST, verifyFSSAI } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { validatePhone, validateEmail, validateGST, validateFSSAI, validatePincode } from '../utils/validation';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessSetup'>;

type Step = 0 | 1 | 2;

interface BusinessTypeOption {
  value: BusinessType;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}

const BUSINESS_TYPES: BusinessTypeOption[] = [
  { value: 'restaurant',    label: 'Restaurant',    icon: 'restaurant' },
  { value: 'hotel',         label: 'Hotel',          icon: 'hotel' },
  { value: 'bakery',        label: 'Bakery',         icon: 'cake' },
  { value: 'cafe',          label: 'Cafe',           icon: 'local-cafe' },
  { value: 'sweet-shop',    label: 'Sweet Shop',     icon: 'icecream' },
  { value: 'juice-shop',    label: 'Juice Shop',     icon: 'local-drink' },
  { value: 'fast-food',     label: 'Fast Food',      icon: 'fastfood' },
  { value: 'cloud-kitchen', label: 'Cloud Kitchen',  icon: 'cloud' },
  { value: 'food-court',    label: 'Food Court',     icon: 'store' },
  { value: 'mess',          label: 'Mess',           icon: 'set-meal' },
  { value: 'catering',      label: 'Catering',       icon: 'room-service' },
];

const STEP_TITLES = ['Business Info', 'Additional Details', 'Review & Submit'];

const BusinessSetupScreen: React.FC<Props> = ({ navigation, route }) => {
  const { settings } = useSettings();
  const { login } = useAuth();
  const { bottom } = useSafeAreaInsets();
  const isResubmit     = route.params?.resubmit ?? false;
  const rejectionReason = route.params?.rejectionReason ?? '';
  const paramPhone      = route.params?.phone ?? '';

  const [step, setStep] = useState<Step>(0);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Step 0 — Required fields
  const [hotelName,    setHotelName]    = useState(isResubmit ? (settings.hotelName || '') : '');
  const [ownerName,    setOwnerName]    = useState(isResubmit ? (settings.ownerName || '') : '');
  const [phone,        setPhone]        = useState(isResubmit ? (settings.phone || paramPhone) : paramPhone);
  const [email,        setEmail]        = useState(isResubmit ? (settings.email || '') : '');
  const [businessType, setBusinessType] = useState<BusinessType>('restaurant');
  const [state,        setState]        = useState('');
  const [city,         setCity]         = useState('');

  // Step 1 — Optional fields
  const [gstNumber,    setGstNumber]    = useState(isResubmit ? (settings.gstNumber || '') : '');
  const [gstVerified,  setGstVerified]  = useState(false);
  const [gstInfo,      setGstInfo]      = useState('');
  const [fssaiNumber,  setFssaiNumber]  = useState(isResubmit ? (settings.fssaiNumber || '') : '');
  const [fssaiVerified, setFssaiVerified] = useState(false);
  const [fssaiInfo,    setFssaiInfo]    = useState('');
  const [address,      setAddress]      = useState(isResubmit ? (settings.address || '') : '');
  const [pincode,      setPincode]      = useState('');
  const [pincodeLoading, setPincodeLoading] = useState(false);

  // Step 2 — T&C
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const validateStep0 = (): boolean => {
    if (!hotelName.trim()) {
      showAlert('Required', 'Please enter your business name');
      return false;
    }
    if (!ownerName.trim()) {
      showAlert('Required', 'Please enter owner name');
      return false;
    }
    if (!phone.trim() || !validatePhone(phone)) {
      showAlert('Invalid Phone', 'Phone number must be exactly 10 digits');
      return false;
    }
    if (!email.trim() || !validateEmail(email)) {
      showAlert('Invalid Email', 'Please enter a valid email address');
      return false;
    }
    if (!state.trim()) {
      showAlert('Required', 'Please enter your state');
      return false;
    }
    if (!city.trim()) {
      showAlert('Required', 'Please enter your city');
      return false;
    }
    return true;
  };

  const validateStep1 = (): boolean => {
    if (gstNumber.trim() && !validateGST(gstNumber)) {
      showAlert('Invalid GST', 'GST number format is invalid (e.g. 29ABCDE1234F1Z5)');
      return false;
    }
    if (fssaiNumber.trim() && !validateFSSAI(fssaiNumber)) {
      showAlert('Invalid FSSAI', 'FSSAI license number must be exactly 14 digits');
      return false;
    }
    if (pincode.trim() && !validatePincode(pincode)) {
      showAlert('Invalid Pincode', 'Pincode must be exactly 6 digits');
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (step === 0 && !validateStep0()) return;
    if (step === 1 && !validateStep1()) return;
    if (step < 2) setStep((step + 1) as Step);
  };

  const handleBack = () => {
    if (step > 0) setStep((step - 1) as Step);
  };

  const handlePincodeBlur = async () => {
    if (pincode.trim().length !== 6) return;
    setPincodeLoading(true);
    try {
      const res = await verifyPincode(pincode.trim());
      if (res.valid) {
        if (!city.trim())  setCity(res.city || '');
        if (!state.trim()) setState(res.state || '');
      }
    } catch { /* ignore */ } finally { setPincodeLoading(false); }
  };

  const handleFssaiBlur = async () => {
    if (fssaiNumber.trim().length !== 14) return;
    try {
      const res = await verifyFSSAI(fssaiNumber.trim());
      if (res.valid) {
        setFssaiVerified(true);
        setFssaiInfo(`${res.licenseType || ''} • ${res.state || ''}`);
      } else {
        setFssaiVerified(false);
        setFssaiInfo(res.message || '');
      }
    } catch { setFssaiVerified(false); }
  };

  const handleGstBlur = async () => {
    if (gstNumber.trim().length !== 15) return;
    try {
      const res = await verifyGST(gstNumber.trim());
      if (res.valid) {
        setGstVerified(true);
        setGstInfo(`State: ${res.state || ''}`);
      } else {
        setGstVerified(false);
        setGstInfo(res.message || '');
      }
    } catch { setGstVerified(false); }
  };

  const handleSubmit = async () => {
    if (!acceptedTerms) {
      showAlert('Terms Required', 'Please accept the Terms & Conditions to continue');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        hotelName:    hotelName.trim(),
        ownerName:    ownerName.trim(),
        phone:        phone.trim(),
        email:        email.trim().toLowerCase(),
        businessType,
        state:        state.trim(),
        city:         city.trim(),
        gstNumber:    gstNumber.trim().toUpperCase(),
        gstVerified,
        fssaiNumber:  fssaiNumber.trim(),
        fssaiVerified,
        address:      address.trim(),
        pincode:      pincode.trim(),
      };

      if (isResubmit) {
        await resubmitHotel(paramPhone || settings.phone, payload);
        navigation.navigate('HotelStatus' as any);
      } else {
        await registerHotel(payload);
        setShowSuccess(true);
      }
    } catch (error: any) {
      showAlert('Registration Failed', error.message || 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── Success screen ─────────────────────────────────────────────────────────

  if (showSuccess) {
    return (
      <View style={styles.successContainer}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.primary} />
        <View style={styles.successIcon}>
          <MaterialIcons name="check-circle" size={80} color={Colors.white} />
        </View>
        <Text style={styles.successTitle}>Registration Submitted!</Text>
        <Text style={styles.successBody}>
          Your application for{'\n'}<Text style={styles.successHotelName}>{hotelName}</Text>{'\n'}
          has been received. Our team will review and approve your account within 24–48 hours.
        </Text>
        <Text style={styles.successSub}>
          We'll reach out to {email} or {phone} with your login credentials once approved.
        </Text>
        <TouchableOpacity
          style={styles.successBtn}
          onPress={() => navigation.navigate('AdminLogin' as any)}
        >
          <Text style={styles.successBtnText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Step header ────────────────────────────────────────────────────────────

  const renderProgress = () => (
    <View style={styles.progressRow}>
      {STEP_TITLES.map((title, idx) => (
        <View key={idx} style={styles.progressItem}>
          <View style={[styles.progressDot, idx <= step && styles.progressDotActive]}>
            {idx < step
              ? <MaterialIcons name="check" size={14} color={Colors.white} />
              : <Text style={[styles.progressDotText, idx === step && styles.progressDotTextActive]}>{idx + 1}</Text>
            }
          </View>
          {idx < STEP_TITLES.length - 1 && (
            <View style={[styles.progressLine, idx < step && styles.progressLineActive]} />
          )}
        </View>
      ))}
    </View>
  );

  // ── Step 0 ─────────────────────────────────────────────────────────────────

  const renderStep0 = () => (
    <>
      <Text style={styles.stepSubtitle}>Required information to create your account</Text>

      {isResubmit && rejectionReason ? (
        <View style={styles.rejectionBanner}>
          <MaterialIcons name="error-outline" size={18} color={Colors.danger} />
          <Text style={styles.rejectionText}>Rejection reason: {rejectionReason}</Text>
        </View>
      ) : null}

      <Text style={styles.label}>Business Name <Text style={styles.required}>*</Text></Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Sai Krishna Restaurant"
        placeholderTextColor={Colors.textMuted}
        value={hotelName}
        onChangeText={setHotelName}
      />

      <Text style={styles.label}>Owner Name <Text style={styles.required}>*</Text></Text>
      <TextInput
        style={styles.input}
        placeholder="Full name"
        placeholderTextColor={Colors.textMuted}
        value={ownerName}
        onChangeText={setOwnerName}
      />

      <Text style={styles.label}>Mobile Number <Text style={styles.required}>*</Text></Text>
      <TextInput
        style={[styles.input, paramPhone && !isResubmit ? styles.inputReadonly : null]}
        placeholder="10-digit mobile number"
        placeholderTextColor={Colors.textMuted}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={10}
        editable={!paramPhone || isResubmit}
      />

      <Text style={styles.label}>Email Address <Text style={styles.required}>*</Text></Text>
      <TextInput
        style={styles.input}
        placeholder="owner@example.com"
        placeholderTextColor={Colors.textMuted}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <Text style={styles.label}>Business Type <Text style={styles.required}>*</Text></Text>
      <View style={styles.typeGrid}>
        {BUSINESS_TYPES.map((bt) => (
          <TouchableOpacity
            key={bt.value}
            style={[styles.typeChip, businessType === bt.value && styles.typeChipSelected]}
            onPress={() => setBusinessType(bt.value)}
          >
            <MaterialIcons
              name={bt.icon}
              size={22}
              color={businessType === bt.value ? Colors.white : Colors.textSecondary}
            />
            <Text style={[styles.typeChipText, businessType === bt.value && styles.typeChipTextSelected]}>
              {bt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        <View style={styles.halfField}>
          <Text style={styles.label}>State <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="Tamil Nadu"
            placeholderTextColor={Colors.textMuted}
            value={state}
            onChangeText={setState}
          />
        </View>
        <View style={[styles.halfField, { marginLeft: Spacing.sm }]}>
          <Text style={styles.label}>City <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="Chennai"
            placeholderTextColor={Colors.textMuted}
            value={city}
            onChangeText={setCity}
          />
        </View>
      </View>
    </>
  );

  // ── Step 1 ─────────────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <>
      <Text style={styles.stepSubtitle}>All fields below are optional</Text>

      <Text style={styles.label}>GST Number</Text>
      <View style={styles.verifyRow}>
        <TextInput
          style={[styles.input, styles.verifyInput, gstVerified && styles.inputVerified]}
          placeholder="29ABCDE1234F1Z5"
          placeholderTextColor={Colors.textMuted}
          value={gstNumber}
          onChangeText={(t) => { setGstNumber(t); setGstVerified(false); setGstInfo(''); }}
          onBlur={handleGstBlur}
          autoCapitalize="characters"
          maxLength={15}
        />
        {gstVerified && <MaterialIcons name="verified" size={20} color={Colors.success} style={styles.verifyIcon} />}
      </View>
      {gstInfo ? <Text style={[styles.verifyInfo, gstVerified ? styles.verifyInfoOk : styles.verifyInfoErr]}>{gstInfo}</Text> : null}

      <Text style={styles.label}>FSSAI License Number</Text>
      <View style={styles.verifyRow}>
        <TextInput
          style={[styles.input, styles.verifyInput, fssaiVerified && styles.inputVerified]}
          placeholder="14-digit FSSAI number"
          placeholderTextColor={Colors.textMuted}
          value={fssaiNumber}
          onChangeText={(t) => { setFssaiNumber(t); setFssaiVerified(false); setFssaiInfo(''); }}
          onBlur={handleFssaiBlur}
          keyboardType="numeric"
          maxLength={14}
        />
        {fssaiVerified && <MaterialIcons name="verified" size={20} color={Colors.success} style={styles.verifyIcon} />}
      </View>
      {fssaiInfo ? <Text style={[styles.verifyInfo, fssaiVerified ? styles.verifyInfoOk : styles.verifyInfoErr]}>{fssaiInfo}</Text> : null}

      <Text style={styles.label}>Full Address</Text>
      <TextInput
        style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
        placeholder="Street, area, landmark..."
        placeholderTextColor={Colors.textMuted}
        value={address}
        onChangeText={setAddress}
        multiline
      />

      <Text style={styles.label}>Pincode</Text>
      <View style={styles.verifyRow}>
        <TextInput
          style={[styles.input, styles.verifyInput]}
          placeholder="6-digit pincode"
          placeholderTextColor={Colors.textMuted}
          value={pincode}
          onChangeText={setPincode}
          onBlur={handlePincodeBlur}
          keyboardType="numeric"
          maxLength={6}
        />
        {pincodeLoading && <ActivityIndicator size="small" color={Colors.primary} style={styles.verifyIcon} />}
      </View>
    </>
  );

  // ── Step 2 ─────────────────────────────────────────────────────────────────

  const renderStep2 = () => (
    <>
      <Text style={styles.stepSubtitle}>Please review and accept to submit</Text>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{hotelName}</Text>
        <Text style={styles.summaryLine}>{ownerName}</Text>
        <Text style={styles.summaryLine}>{phone} • {email}</Text>
        <Text style={styles.summaryLine}>{businessType.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase())}</Text>
        <Text style={styles.summaryLine}>{city}, {state}</Text>
        {gstNumber ? <Text style={styles.summaryLine}>GST: {gstNumber}</Text> : null}
        {fssaiNumber ? <Text style={styles.summaryLine}>FSSAI: {fssaiNumber}</Text> : null}
      </View>

      <View style={styles.termsCard}>
        <Text style={styles.termsTitle}>Terms & Conditions</Text>
        <Text style={styles.termsText}>
          By registering, you confirm that:{'\n\n'}
          • All information provided is accurate and truthful{'\n'}
          • You are authorised to register this business{'\n'}
          • You agree to Dine POS Terms of Service and Privacy Policy{'\n'}
          • You consent to receive communications about your account
        </Text>
        <TouchableOpacity
          style={styles.termsCheckRow}
          onPress={() => setAcceptedTerms(!acceptedTerms)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
            {acceptedTerms && <MaterialIcons name="check" size={14} color={Colors.white} />}
          </View>
          <Text style={styles.termsCheckText}>I accept the Terms & Conditions</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primary} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={step === 0 ? () => navigation.goBack() : handleBack} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {isResubmit ? 'Update Registration' : 'Register Your Business'}
          </Text>
          <Text style={styles.headerSubtitle}>Step {step + 1} of 3 — {STEP_TITLES[step]}</Text>
        </View>
      </View>

      {renderProgress()}

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: bottom + Spacing.xl * 2 }} keyboardShouldPersistTaps="handled">
        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: bottom + Spacing.md }]}>
        {step < 2 ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleNext}>
            <Text style={styles.primaryBtnText}>Continue</Text>
            <MaterialIcons name="arrow-forward" size={20} color={Colors.white} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, (!acceptedTerms || saving) && styles.primaryBtnDisabled]}
            onPress={handleSubmit}
            disabled={saving || !acceptedTerms}
          >
            {saving
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <><Text style={styles.primaryBtnText}>{isResubmit ? 'Resubmit' : 'Submit Registration'}</Text><MaterialIcons name="send" size={20} color={Colors.white} /></>
            }
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.background },
  header:      { backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.lg, paddingBottom: Spacing.md },
  backBtn:     { marginRight: Spacing.sm },
  headerTitle: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
  headerSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: FontSize.sm, marginTop: 2 },

  progressRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  progressItem: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  progressDot:  { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  progressDotActive: { backgroundColor: Colors.primary },
  progressDotText:   { fontSize: 13, color: Colors.textMuted, fontWeight: '600' },
  progressDotTextActive: { color: Colors.white },
  progressLine: { flex: 1, height: 2, backgroundColor: Colors.border, marginHorizontal: 4 },
  progressLineActive: { backgroundColor: Colors.primary },

  body: { flex: 1, paddingHorizontal: Spacing.md, paddingTop: Spacing.md },

  stepSubtitle: { color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md },

  rejectionBanner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#FFF0F0', borderRadius: BorderRadius.sm, borderLeftWidth: 3, borderLeftColor: Colors.danger, padding: Spacing.sm, marginBottom: Spacing.md, gap: Spacing.xs },
  rejectionText:   { flex: 1, color: Colors.danger, fontSize: FontSize.sm },

  label:    { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600', marginBottom: 4, marginTop: Spacing.sm },
  required: { color: Colors.danger },
  input:    { backgroundColor: Colors.surface, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, color: Colors.text, fontSize: FontSize.md, minHeight: 48 },
  inputReadonly: { backgroundColor: Colors.card, color: Colors.textSecondary },
  inputVerified: { borderColor: Colors.success },

  row:       { flexDirection: 'row' },
  halfField: { flex: 1 },

  typeGrid:            { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 4 },
  typeChip:            { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface },
  typeChipSelected:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeChipText:        { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '500' },
  typeChipTextSelected:{ color: Colors.white, fontWeight: '700' },

  verifyRow:     { flexDirection: 'row', alignItems: 'center' },
  verifyInput:   { flex: 1 },
  verifyIcon:    { marginLeft: Spacing.sm },
  verifyInfo:    { fontSize: FontSize.xs, marginTop: 2 },
  verifyInfoOk:  { color: Colors.success },
  verifyInfoErr: { color: Colors.danger },

  summaryCard:  { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.md },
  summaryTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: Spacing.xs },
  summaryLine:  { color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 2 },

  termsCard:      { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md },
  termsTitle:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  termsText:      { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.md },
  termsCheckRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkbox:       { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked:{ backgroundColor: Colors.primary, borderColor: Colors.primary },
  termsCheckText: { flex: 1, color: Colors.text, fontSize: FontSize.sm, fontWeight: '500' },

  footer:        { backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  primaryBtn:    { backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText:{ color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  // Success screen
  successContainer: { flex: 1, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl },
  successIcon:      { marginBottom: Spacing.lg },
  successTitle:     { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.white, textAlign: 'center', marginBottom: Spacing.md },
  successBody:      { fontSize: FontSize.md, color: 'rgba(255,255,255,0.9)', textAlign: 'center', lineHeight: 24, marginBottom: Spacing.md },
  successHotelName: { fontWeight: '800', color: Colors.white },
  successSub:       { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: Spacing.xl },
  successBtn:       { backgroundColor: Colors.white, borderRadius: BorderRadius.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl },
  successBtnText:   { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },
});

export default BusinessSetupScreen;
