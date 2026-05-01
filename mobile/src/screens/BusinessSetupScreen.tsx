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
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { showAlert } from '../utils/alert';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { registerHotel, resubmitHotel, verifyPincode, verifyIFSC, verifyPAN, verifyGST, verifyFSSAI } from '../services/api';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessSetup'>;

type Step = 'business' | 'contact' | 'legal' | 'bank';

const STEPS: Step[] = ['business', 'contact', 'legal', 'bank'];

const STEP_LABELS: Record<Step, string> = {
  business: 'Business Info',
  contact: 'Contact',
  legal: 'Legal & Licenses',
  bank: 'Bank Details',
};

const STEP_ICONS: Record<Step, keyof typeof MaterialIcons.glyphMap> = {
  business: 'store',
  contact: 'contact-phone',
  legal: 'verified',
  bank: 'account-balance',
};

const BusinessSetupScreen: React.FC<Props> = ({ navigation, route }) => {
  const { login } = useAuth();
  const { saveSettings, settings } = useSettings();
  const isResubmit = route.params?.resubmit ?? false;
  const rejectionReason = route.params?.rejectionReason ?? '';
  const resubmitPhone = route.params?.phone ?? '';

  const [currentStep, setCurrentStep] = useState<Step>('business');
  const [saving, setSaving] = useState(false);

  // Business Info — prefill from settings when resubmitting
  const [hotelName, setHotelName] = useState(isResubmit ? (settings.hotelName || '') : '');
  const [ownerName, setOwnerName] = useState(isResubmit ? (settings.ownerName || '') : '');
  const [businessType, setBusinessType] = useState<'veg' | 'non-veg' | 'both'>(
    isResubmit ? ((settings.businessType as 'veg' | 'non-veg' | 'both') || 'both') : 'both'
  );

  // Contact
  const [phone, setPhone] = useState(isResubmit ? (settings.phone || '') : '');
  const [email, setEmail] = useState(isResubmit ? (settings.email || '') : '');
  const [address, setAddress] = useState(isResubmit ? (settings.address || '') : '');
  const [pincode, setPincode] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincodeLoading, setPincodeLoading] = useState(false);

  // Legal
  const [fssaiNumber, setFssaiNumber] = useState(isResubmit ? (settings.fssaiNumber || '') : '');
  const [fssaiVerified, setFssaiVerified] = useState(false);
  const [fssaiInfo, setFssaiInfo] = useState('');
  const [gstNumber, setGstNumber] = useState(isResubmit ? (settings.gstNumber || '') : '');
  const [gstVerified, setGstVerified] = useState(false);
  const [gstInfo, setGstInfo] = useState('');
  const [panNumber, setPanNumber] = useState(isResubmit ? (settings.panNumber || '') : '');
  const [panVerified, setPanVerified] = useState(false);
  const [panInfo, setPanInfo] = useState('');

  // Bank
  const [bankName, setBankName] = useState(isResubmit ? (settings.bankName || '') : '');
  const [bankBranch, setBankBranch] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState(isResubmit ? (settings.bankAccountHolder || '') : '');
  const [bankAccountNumber, setBankAccountNumber] = useState(isResubmit ? (settings.bankAccountNumber || '') : '');
  const [bankIfscCode, setBankIfscCode] = useState(isResubmit ? (settings.bankIfscCode || '') : '');
  const [upiId, setUpiId] = useState(isResubmit ? (settings.upiId || '') : '');
  const [ifscVerified, setIfscVerified] = useState(false);
  const [ifscLoading, setIfscLoading] = useState(false);

  const stepIndex = STEPS.indexOf(currentStep);

  const validateStep = (): boolean => {
    switch (currentStep) {
      case 'business':
        if (!hotelName.trim()) {
          showAlert('Required', 'Please enter your restaurant name');
          return false;
        }
        if (!ownerName.trim()) {
          showAlert('Required', 'Please enter owner name');
          return false;
        }
        return true;

      case 'contact': {
        if (!phone.trim()) {
          showAlert('Required', 'Please enter phone number');
          return false;
        }
        if (!/^\d{10}$/.test(phone.trim())) {
          showAlert('Invalid Phone', 'Phone number must be exactly 10 digits');
          return false;
        }
        if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          showAlert('Invalid Email', 'Please enter a valid email address');
          return false;
        }
        if (!address.trim()) {
          showAlert('Required', 'Please enter your full address');
          return false;
        }
        if (!pincode.trim()) {
          showAlert('Required', 'Please enter your 6-digit pincode');
          return false;
        }
        if (!/^\d{6}$/.test(pincode.trim())) {
          showAlert('Invalid Pincode', 'Pincode must be exactly 6 digits');
          return false;
        }
        if (!city.trim()) {
          showAlert('Required', 'Please enter your city (or wait for pincode auto-fill)');
          return false;
        }
        if (!state.trim()) {
          showAlert('Required', 'Please enter your state (or wait for pincode auto-fill)');
          return false;
        }
        return true;
      }

      case 'legal':
        if (!fssaiNumber.trim()) {
          showAlert('Required', 'FSSAI license number is mandatory');
          return false;
        }
        if (!/^\d{14}$/.test(fssaiNumber.trim())) {
          showAlert('Invalid FSSAI', 'FSSAI license number must be exactly 14 digits');
          return false;
        }
        if (gstNumber.trim() && !/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/.test(gstNumber.trim().toUpperCase())) {
          showAlert('Invalid GST', 'GST number format is invalid (e.g. 29ABCDE1234F1Z5)');
          return false;
        }
        if (panNumber.trim() && !/^[A-Z]{5}\d{4}[A-Z]{1}$/.test(panNumber.trim().toUpperCase())) {
          showAlert('Invalid PAN', 'PAN number format is invalid (e.g. ABCDE1234F)');
          return false;
        }
        return true;

      case 'bank':
        if (bankIfscCode.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfscCode.trim().toUpperCase())) {
          showAlert('Invalid IFSC', 'IFSC code format is invalid (e.g. SBIN0001234)');
          return false;
        }
        if (bankAccountNumber.trim() && !/^\d{9,18}$/.test(bankAccountNumber.trim())) {
          showAlert('Invalid Account Number', 'Account number must be 9–18 digits');
          return false;
        }
        return true;
    }
  };

  const handlePincodeBlur = async () => {
    if (pincode.length !== 6) return;
    setPincodeLoading(true);
    try {
      const res = await verifyPincode(pincode);
      if (res.valid) { setCity(res.city || ''); setState(res.state || ''); }
    } catch { /* ignore */ } finally { setPincodeLoading(false); }
  };

  const handleIfscBlur = async () => {
    const code = bankIfscCode.trim().toUpperCase();
    if (code.length !== 11) return;
    setIfscLoading(true);
    try {
      const res = await verifyIFSC(code);
      if (res.valid) {
        setBankName(res.bank || '');
        setBankBranch(res.branch || '');
        setIfscVerified(true);
      } else { setIfscVerified(false); }
    } catch { setIfscVerified(false); } finally { setIfscLoading(false); }
  };

  const handleFssaiBlur = async () => {
    if (fssaiNumber.length !== 14) return;
    try {
      const res = await verifyFSSAI(fssaiNumber);
      if (res.valid) { setFssaiVerified(true); setFssaiInfo(`${res.licenseType} • ${res.state}`); }
      else { setFssaiVerified(false); setFssaiInfo(res.message || ''); }
    } catch { setFssaiVerified(false); }
  };

  const handleGstBlur = async () => {
    if (gstNumber.length !== 15) return;
    try {
      const res = await verifyGST(gstNumber);
      if (res.valid) { setGstVerified(true); setGstInfo(`State: ${res.state}`); }
      else { setGstVerified(false); setGstInfo(res.message || ''); }
    } catch { setGstVerified(false); }
  };

  const handlePanBlur = async () => {
    if (panNumber.length !== 10) return;
    try {
      const res = await verifyPAN(panNumber);
      if (res.valid) { setPanVerified(true); setPanInfo(`Holder Type: ${res.holderType}`); }
      else { setPanVerified(false); setPanInfo(res.message || ''); }
    } catch { setPanVerified(false); }
  };

  const handleNext = () => {
    if (!validateStep()) return;
    const nextIndex = stepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]);
    }
  };

  const handleBack = () => {
    const prevIndex = stepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex]);
    }
  };

  const handleFinish = async () => {
    if (!validateStep()) return;
    setSaving(true);
    try {
      const payload = {
        hotelName: hotelName.trim(),
        ownerName: ownerName.trim(),
        businessType,
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
        fssaiNumber: fssaiNumber.trim(),
        fssaiVerified: fssaiVerified,
        gstNumber: gstNumber.trim(),
        gstVerified: gstVerified,
        panNumber: panNumber.trim(),
        panVerified: panVerified,
        bankName: bankName.trim(),
        bankBranch: bankBranch.trim(),
        bankAccountHolder: bankAccountHolder.trim(),
        bankAccountNumber: bankAccountNumber.trim(),
        bankIfscCode: bankIfscCode.trim().toUpperCase(),
        ifscVerified: ifscVerified,
        upiId: upiId.trim(),
        isSetupComplete: true,
      };

      // Save to Settings (for POS use)
      await saveSettings(payload);

      if (isResubmit && resubmitPhone) {
        // Update hotel record and reset to pending
        await resubmitHotel(resubmitPhone, payload);
        navigation.replace('HotelStatus', {
          status: 'pending',
          hotelName: payload.hotelName,
        });
      } else {
        // First-time registration
        try {
          await registerHotel(payload);
        } catch {
          // Already registered or non-critical — continue anyway
        }
        await login();
      }
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderStepIndicator = () => (
    <View style={styles.stepIndicator}>
      {STEPS.map((step, index) => {
        const isDone = index < stepIndex;
        const isActive = step === currentStep;
        return (
          <React.Fragment key={step}>
            <View style={styles.stepItem}>
              <View style={[
                styles.stepDot,
                isDone && styles.stepDotDone,
                isActive && styles.stepDotActive,
              ]}>
                {isDone ? (
                  <MaterialIcons name="check" size={14} color={Colors.white} />
                ) : (
                  <Text style={[styles.stepNumber, isActive && styles.stepNumberActive]}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>
                {STEP_LABELS[step]}
              </Text>
            </View>
            {index < STEPS.length - 1 && (
              <View style={[styles.stepLine, isDone && styles.stepLineDone]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );

  const renderBusinessStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <MaterialIcons name="store" size={40} color={Colors.primary} />
        <Text style={styles.stepTitle}>Business Information</Text>
        <Text style={styles.stepSubtitle}>Tell us about your restaurant</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Restaurant / Hotel Name *</Text>
        <TextInput
          style={styles.input}
          value={hotelName}
          onChangeText={setHotelName}
          placeholder="e.g. Jegatheswar Hotel"
          placeholderTextColor={Colors.textMuted}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Owner Name *</Text>
        <TextInput
          style={styles.input}
          value={ownerName}
          onChangeText={setOwnerName}
          placeholder="e.g. K. Jegatheswar"
          placeholderTextColor={Colors.textMuted}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Business Type *</Text>
        <View style={styles.typeRow}>
          {(['veg', 'non-veg', 'both'] as const).map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.typeBtn, businessType === type && styles.typeBtnActive]}
              onPress={() => setBusinessType(type)}
            >
              <Text style={[styles.typeBtnText, businessType === type && styles.typeBtnTextActive]}>
                {type === 'veg' ? '🌿 Veg' : type === 'non-veg' ? '🍗 Non-Veg' : '🍽 Both'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );

  const renderContactStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <MaterialIcons name="contact-phone" size={40} color={Colors.info} />
        <Text style={styles.stepTitle}>Contact Details</Text>
        <Text style={styles.stepSubtitle}>How customers can reach you</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Phone Number *</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="e.g. 9876543210"
          placeholderTextColor={Colors.textMuted}
          keyboardType="phone-pad"
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Email Address</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="e.g. hotel@gmail.com"
          placeholderTextColor={Colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Full Address *</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={address}
          onChangeText={setAddress}
          placeholder="Door No, Street Name"
          placeholderTextColor={Colors.textMuted}
          multiline
          numberOfLines={2}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Pincode *</Text>
        <View style={styles.verifyRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={pincode}
            onChangeText={setPincode}
            onBlur={handlePincodeBlur}
            placeholder="6-digit pincode"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            maxLength={6}
          />
          {pincodeLoading && <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 8 }} />}
        </View>
        {city ? <Text style={styles.verifySuccess}>{city}, {state}</Text> : null}
      </View>

      <View style={styles.rowFields}>
        <View style={[styles.fieldGroup, { flex: 1 }]}>
          <Text style={styles.label}>City</Text>
          <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={Colors.textMuted} />
        </View>
        <View style={[styles.fieldGroup, { flex: 1 }]}>
          <Text style={styles.label}>State</Text>
          <TextInput style={styles.input} value={state} onChangeText={setState} placeholder="State" placeholderTextColor={Colors.textMuted} />
        </View>
      </View>
    </View>
  );

  const renderLegalStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <MaterialIcons name="verified" size={40} color={Colors.success} />
        <Text style={styles.stepTitle}>Legal & Licenses</Text>
        <Text style={styles.stepSubtitle}>Required for operating legally</Text>
      </View>

      <View style={[styles.infoBox]}>
        <MaterialIcons name="info-outline" size={16} color={Colors.info} />
        <Text style={styles.infoText}>
          FSSAI license is mandatory for all food businesses in India. Apply at fssai.gov.in if you don't have one.
        </Text>
      </View>

      {renderVerifyField('FSSAI License Number *', fssaiNumber, setFssaiNumber, handleFssaiBlur, '14-digit FSSAI number', 'number-pad', 14, fssaiVerified, fssaiInfo)}
      {renderVerifyField('GST Number', gstNumber, setGstNumber, handleGstBlur, '15-character GSTIN', 'default', 15, gstVerified, gstInfo, true)}
      {renderVerifyField('PAN Number', panNumber, setPanNumber, handlePanBlur, 'e.g. ABCDE1234F', 'default', 10, panVerified, panInfo, true)}
    </View>
  );

  const renderBankStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.stepHeader}>
        <MaterialIcons name="account-balance" size={40} color={Colors.upi} />
        <Text style={styles.stepTitle}>Bank Details</Text>
        <Text style={styles.stepSubtitle}>For UPI & payment reconciliation</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>IFSC Code</Text>
        <View style={styles.verifyRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={bankIfscCode}
            onChangeText={(v) => { setBankIfscCode(v); setIfscVerified(false); setBankName(''); setBankBranch(''); }}
            onBlur={handleIfscBlur}
            placeholder="e.g. SBIN0001234"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
            maxLength={11}
          />
          {ifscLoading
            ? <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 8 }} />
            : ifscVerified
              ? <MaterialIcons name="verified" size={22} color={Colors.success} style={{ marginLeft: 8 }} />
              : null}
        </View>
        {ifscVerified && bankName ? <Text style={styles.verifySuccess}>{bankName} • {bankBranch}</Text> : null}
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Bank Name</Text>
        <TextInput style={styles.input} value={bankName} onChangeText={setBankName} placeholder="Auto-filled from IFSC" placeholderTextColor={Colors.textMuted} />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Account Holder Name</Text>
        <TextInput style={styles.input} value={bankAccountHolder} onChangeText={setBankAccountHolder} placeholder="As per bank records" placeholderTextColor={Colors.textMuted} />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Account Number</Text>
        <TextInput style={styles.input} value={bankAccountNumber} onChangeText={setBankAccountNumber} placeholder="Bank account number" placeholderTextColor={Colors.textMuted} keyboardType="number-pad" />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>UPI ID</Text>
        <View style={[styles.verifyRow, { backgroundColor: Colors.card, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12 }]}>
          <MaterialIcons name="phone-android" size={18} color={Colors.upi} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.input, { flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 }]}
            value={upiId}
            onChangeText={setUpiId}
            placeholder="e.g. 9876543210@upi"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>
        {upiId.trim() !== '' && (
          <Text style={/^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiId.trim()) ? styles.verifySuccess : styles.verifyWarn}>
            {/^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(upiId.trim()) ? 'Valid UPI ID format' : 'Format: phonenumber@upi or name@bank'}
          </Text>
        )}
      </View>

      <Text style={styles.skipNote}>* Bank & UPI details are optional but recommended</Text>
    </View>
  );

  const renderVerifyField = (
    label: string, value: string,
    onChange: (v: string) => void,
    onBlur: () => void,
    placeholder: string,
    keyboardType: any,
    maxLength: number,
    verified: boolean,
    info: string,
    uppercase = false,
  ) => (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.verifyRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={value}
          onChangeText={(v) => { onChange(uppercase ? v.toUpperCase() : v); }}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          keyboardType={keyboardType}
          maxLength={maxLength}
          autoCapitalize={uppercase ? 'characters' : 'none'}
        />
        {value.length === maxLength && (
          <MaterialIcons
            name={verified ? 'verified' : 'error-outline'}
            size={22}
            color={verified ? Colors.success : Colors.warning}
            style={{ marginLeft: 8 }}
          />
        )}
      </View>
      {info ? (
        <Text style={verified ? styles.verifySuccess : styles.verifyWarn}>{info}</Text>
      ) : null}
    </View>
  );

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'business': return renderBusinessStep();
      case 'contact': return renderContactStep();
      case 'legal': return renderLegalStep();
      case 'bank': return renderBankStep();
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{isResubmit ? 'Resubmit Registration' : 'Business Setup'}</Text>
        <Text style={styles.headerSubtitle}>Step {stepIndex + 1} of {STEPS.length}</Text>
      </View>

      {/* Rejection Banner */}
      {isResubmit && (
        <View style={styles.rejectionBanner}>
          <MaterialIcons name="cancel" size={22} color={Colors.danger} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rejectionBannerTitle}>Registration Rejected</Text>
            <Text style={styles.rejectionBannerText}>{rejectionReason}</Text>
            <Text style={styles.rejectionBannerHint}>Please correct the details below and resubmit for approval.</Text>
          </View>
        </View>
      )}

      {/* Step Indicator */}
      {renderStepIndicator()}

      {/* Step Content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderCurrentStep()}
      </ScrollView>

      {/* Navigation Buttons */}
      <View style={styles.footer}>
        {stepIndex > 0 ? (
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <MaterialIcons name="arrow-back" size={20} color={Colors.textSecondary} />
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}

        {currentStep === 'bank' ? (
          <TouchableOpacity
            style={styles.finishBtn}
            onPress={handleFinish}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <>
                <MaterialIcons name={isResubmit ? 'send' : 'check-circle'} size={20} color={Colors.white} />
                <Text style={styles.finishBtnText}>{isResubmit ? 'Resubmit for Approval' : 'Finish Setup'}</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
            <Text style={styles.nextBtnText}>Next</Text>
            <MaterialIcons name="arrow-forward" size={20} color={Colors.white} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: 'bold', color: Colors.text },
  headerSubtitle: { fontSize: FontSize.md, color: Colors.textSecondary },

  rejectionBanner: {
    flexDirection: 'row',
    backgroundColor: Colors.danger + '18',
    borderBottomWidth: 2,
    borderBottomColor: Colors.danger,
    padding: Spacing.lg,
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  rejectionBannerTitle: { color: Colors.danger, fontSize: FontSize.md, fontWeight: 'bold', marginBottom: 2 },
  rejectionBannerText: { color: Colors.text, fontSize: FontSize.sm, lineHeight: 20, marginBottom: 4 },
  rejectionBannerHint: { color: Colors.textSecondary, fontSize: FontSize.xs, fontStyle: 'italic' },

  // Step indicator
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDotActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  stepDotDone: { borderColor: Colors.success, backgroundColor: Colors.success },
  stepNumber: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: 'bold' },
  stepNumberActive: { color: Colors.white },
  stepLabel: { fontSize: 9, color: Colors.textMuted, textAlign: 'center', maxWidth: 55 },
  stepLabelActive: { color: Colors.primary, fontWeight: 'bold' },
  stepLine: { flex: 1, height: 2, backgroundColor: Colors.border, marginBottom: 14 },
  stepLineDone: { backgroundColor: Colors.success },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.lg, paddingBottom: 40 },

  // Step content
  stepContent: { gap: Spacing.md },
  stepHeader: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.sm },
  stepTitle: { fontSize: FontSize.xxl, fontWeight: 'bold', color: Colors.text },
  stepSubtitle: { fontSize: FontSize.md, color: Colors.textSecondary },

  // Fields
  fieldGroup: { gap: Spacing.xs },
  label: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    color: Colors.text,
    fontSize: FontSize.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },

  // Business type
  typeRow: { flexDirection: 'row', gap: Spacing.sm },
  typeBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.card,
  },
  typeBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  typeBtnText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },
  typeBtnTextActive: { color: Colors.primary },

  // Info box
  infoBox: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.info,
    alignItems: 'flex-start',
  },
  infoText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 18 },

  skipNote: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', fontStyle: 'italic' },
  verifyRow: { flexDirection: 'row', alignItems: 'center' },
  verifySuccess: { fontSize: FontSize.sm, color: Colors.success, marginTop: 4, fontWeight: '600' },
  verifyWarn: { fontSize: FontSize.sm, color: Colors.warning, marginTop: 4 },
  rowFields: { flexDirection: 'row', gap: Spacing.sm },

  // Footer
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  backBtnText: { color: Colors.textSecondary, fontSize: FontSize.lg },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  nextBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: 'bold' },
  finishBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.success,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  finishBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: 'bold' },
});

export default BusinessSetupScreen;
