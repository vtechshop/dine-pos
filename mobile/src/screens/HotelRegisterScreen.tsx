import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, BusinessType } from '../types';
import { showAlert } from '../utils/alert';
import { Colors } from '../utils/constants';
import { registerHotel } from '../services/api';

type Props = NativeStackScreenProps<RootStackParamList, 'HotelRegister'>;

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'restaurant',    label: 'Restaurant' },
  { value: 'hotel',         label: 'Hotel' },
  { value: 'bakery',        label: 'Bakery' },
  { value: 'cafe',          label: 'Café' },
  { value: 'sweet-shop',    label: 'Sweet Shop' },
  { value: 'juice-shop',    label: 'Juice Shop' },
  { value: 'fast-food',     label: 'Fast Food' },
  { value: 'cloud-kitchen', label: 'Cloud Kitchen' },
  { value: 'food-court',    label: 'Food Court' },
  { value: 'mess',          label: 'Mess' },
  { value: 'catering',      label: 'Catering' },
  { value: 'veg',           label: 'Pure Veg' },
  { value: 'non-veg',       label: 'Non-Veg' },
  { value: 'both',          label: 'Veg & Non-Veg' },
];

const HotelRegisterScreen: React.FC<Props> = ({ navigation }) => {
  const [hotelName, setHotelName]     = useState('');
  const [ownerName, setOwnerName]     = useState('');
  const [phone, setPhone]             = useState('');
  const [email, setEmail]             = useState('');
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [stateVal, setStateVal]       = useState('');
  const [city, setCity]               = useState('');
  const [loading, setLoading]         = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  const [nameFocus, setNameFocus]   = useState(false);
  const [ownerFocus, setOwnerFocus] = useState(false);
  const [phoneFocus, setPhoneFocus] = useState(false);
  const [emailFocus, setEmailFocus] = useState(false);
  const [stateFocus, setStateFocus] = useState(false);
  const [cityFocus, setCityFocus]   = useState(false);

  const selectedType = BUSINESS_TYPES.find(t => t.value === businessType);

  const handleSubmit = async () => {
    if (!hotelName.trim())                   { showAlert('Required', 'Business name is required.');               return; }
    if (!ownerName.trim())                   { showAlert('Required', 'Owner name is required.');                  return; }
    if (!/^\d{10}$/.test(phone.trim()))      { showAlert('Invalid',  'Enter a valid 10-digit mobile number.');   return; }
    if (!businessType)                        { showAlert('Required', 'Please select a business type.');           return; }
    if (!stateVal.trim())                    { showAlert('Required', 'State is required.');                       return; }
    if (!city.trim())                        { showAlert('Required', 'City is required.');                        return; }

    setLoading(true);
    try {
      await registerHotel({
        hotelName:    hotelName.trim(),
        ownerName:    ownerName.trim(),
        phone:        phone.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        businessType: businessType as BusinessType,
        state:        stateVal.trim(),
        city:         city.trim(),
      });
      navigation.replace('HotelRegisterSuccess');
    } catch (e: any) {
      showAlert('Registration Failed', e.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.surface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Hotel Registration</Text>
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subTitle}>Fill in your business details to get started</Text>

        <Text style={styles.label}>Business Name *</Text>
        <View style={[styles.inputWrap, nameFocus && styles.inputFocused]}>
          <MaterialIcons name="storefront" size={20} color={nameFocus ? Colors.primary : Colors.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Your restaurant / hotel name"
            placeholderTextColor={Colors.textMuted}
            value={hotelName}
            onChangeText={setHotelName}
            onFocus={() => setNameFocus(true)}
            onBlur={() => setNameFocus(false)}
            autoCapitalize="words"
          />
        </View>

        <Text style={styles.label}>Owner Name *</Text>
        <View style={[styles.inputWrap, ownerFocus && styles.inputFocused]}>
          <MaterialIcons name="person-outline" size={20} color={ownerFocus ? Colors.primary : Colors.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="Full name of the owner"
            placeholderTextColor={Colors.textMuted}
            value={ownerName}
            onChangeText={setOwnerName}
            onFocus={() => setOwnerFocus(true)}
            onBlur={() => setOwnerFocus(false)}
            autoCapitalize="words"
          />
        </View>

        <Text style={styles.label}>Mobile Number *</Text>
        <View style={[styles.inputWrap, phoneFocus && styles.inputFocused]}>
          <MaterialIcons name="phone" size={20} color={phoneFocus ? Colors.primary : Colors.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="10-digit mobile number"
            placeholderTextColor={Colors.textMuted}
            value={phone}
            onChangeText={t => setPhone(t.replace(/\D/g, '').slice(0, 10))}
            onFocus={() => setPhoneFocus(true)}
            onBlur={() => setPhoneFocus(false)}
            keyboardType="phone-pad"
            maxLength={10}
          />
        </View>

        <Text style={styles.label}>Email (optional)</Text>
        <View style={[styles.inputWrap, emailFocus && styles.inputFocused]}>
          <MaterialIcons name="email" size={20} color={emailFocus ? Colors.primary : Colors.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="owner@example.com"
            placeholderTextColor={Colors.textMuted}
            value={email}
            onChangeText={setEmail}
            onFocus={() => setEmailFocus(true)}
            onBlur={() => setEmailFocus(false)}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <Text style={styles.label}>Business Type *</Text>
        <TouchableOpacity
          style={[styles.inputWrap, pickerVisible && styles.inputFocused]}
          onPress={() => setPickerVisible(true)}
          activeOpacity={0.7}
        >
          <MaterialIcons name="category" size={20} color={businessType ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.input, !selectedType && { color: Colors.textMuted }]}>
            {selectedType ? selectedType.label : 'Select type…'}
          </Text>
          <MaterialIcons name="expand-more" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>

        <Text style={styles.label}>State *</Text>
        <View style={[styles.inputWrap, stateFocus && styles.inputFocused]}>
          <MaterialIcons name="location-on" size={20} color={stateFocus ? Colors.primary : Colors.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="e.g. Tamil Nadu"
            placeholderTextColor={Colors.textMuted}
            value={stateVal}
            onChangeText={setStateVal}
            onFocus={() => setStateFocus(true)}
            onBlur={() => setStateFocus(false)}
            autoCapitalize="words"
          />
        </View>

        <Text style={styles.label}>City *</Text>
        <View style={[styles.inputWrap, cityFocus && styles.inputFocused]}>
          <MaterialIcons name="location-city" size={20} color={cityFocus ? Colors.primary : Colors.textSecondary} />
          <TextInput
            style={styles.input}
            placeholder="e.g. Chennai"
            placeholderTextColor={Colors.textMuted}
            value={city}
            onChangeText={setCity}
            onFocus={() => setCityFocus(true)}
            onBlur={() => setCityFocus(false)}
            autoCapitalize="words"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator size="small" color={Colors.surface} />
            : <Text style={styles.submitText}>Register Hotel</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.loginRow} onPress={() => navigation.goBack()}>
          <Text style={styles.loginText}>Already registered? </Text>
          <Text style={[styles.loginText, { color: Colors.primary, fontWeight: '800' }]}>Login →</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPickerVisible(false)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Select Business Type</Text>
            <ScrollView>
              {BUSINESS_TYPES.map(t => (
                <TouchableOpacity
                  key={t.value}
                  style={[
                    styles.modalOption,
                    businessType === t.value && styles.modalOptionSelected,
                  ]}
                  onPress={() => { setBusinessType(t.value); setPickerVisible(false); }}
                >
                  <Text style={[
                    styles.modalOptionText,
                    businessType === t.value && styles.modalOptionTextSelected,
                  ]}>
                    {t.label}
                  </Text>
                  {businessType === t.value && (
                    <MaterialIcons name="check" size={18} color={Colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  header:  {
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn:      { padding: 4, marginRight: 12 },
  headerTitle:  { fontSize: 18, fontWeight: '700', color: Colors.surface, flex: 1 },
  container:    { padding: 20, paddingBottom: 48 },
  subTitle:     { fontSize: 13, color: Colors.textSecondary, marginBottom: 16 },
  label:        { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6, marginTop: 16 },
  inputWrap:    {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputFocused: { borderColor: Colors.primary },
  input:        { flex: 1, fontSize: 14, color: Colors.text, marginLeft: 10, padding: 0 },
  submitBtn:    {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 28,
  },
  submitDisabled: { opacity: 0.65 },
  submitText:   { fontSize: 15, fontWeight: '700', color: Colors.surface },
  loginRow:     { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  loginText:    { fontSize: 14, color: Colors.textSecondary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet:   {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '72%',
  },
  modalHandle:  {
    width: 40, height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginVertical: 12,
  },
  modalTitle:        { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  modalOption:       {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalOptionSelected:     { backgroundColor: Colors.primaryBg, marginHorizontal: -20, paddingHorizontal: 20 },
  modalOptionText:         { fontSize: 14, color: Colors.text },
  modalOptionTextSelected: { color: Colors.primary, fontWeight: '600' },
});

export default HotelRegisterScreen;
