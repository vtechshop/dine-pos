import React, { useState, useEffect } from 'react';
import { showAlert } from '../utils/alert';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Alert,
  Linking,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ROLE_IMG_KEYS } from './RoleSelectScreen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, FontSize, BorderRadius } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';
import { useCart } from '../context/CartContext';
import { registerHotel, clearApiUrlCache, seedData } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../types';
import { getPairedDevices, connectPrinter, BluetoothDevice, BT_PERMISSION_DENIED } from '../utils/bluetoothPrint';

const API_URL_STORAGE_KEY = '@hotel_pos_api_base_url';
const BT_PRINTER_KEY = '@hotel_pos_bt_printer';
const BT_PRINTER_ADDRESS_KEY = '@hotel_pos_bt_printer_address';

const SettingsScreen: React.FC = () => {
  const { settings, saveSettings, loading } = useSettings();
  const { logout } = useAuth();
  const { clearCart } = useCart();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bottom } = useSafeAreaInsets();

  // Form state
  const [hotelName, setHotelName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [businessType, setBusinessType] = useState<'veg' | 'non-veg' | 'both'>('both');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fssaiNumber, setFssaiNumber] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankIfscCode, setBankIfscCode] = useState('');
  const [upiId, setUpiId] = useState('');
  const [defaultTaxPercent, setDefaultTaxPercent] = useState('');
  const [printerWidth, setPrinterWidth] = useState<'58mm' | '80mm'>('80mm');
  const [footerText, setFooterText] = useState('');
  const [kitchenPin, setKitchenPin] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');

  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);

  // Role card images
  const [roleImgs, setRoleImgs] = useState({ customer: '', admin: '', staff: '' });
  useEffect(() => {
    AsyncStorage.multiGet([ROLE_IMG_KEYS.customer, ROLE_IMG_KEYS.admin, ROLE_IMG_KEYS.staff])
      .then(([[, c], [, a], [, s]]) => setRoleImgs({ customer: c || '', admin: a || '', staff: s || '' }))
      .catch(() => {});
  }, []);

  const pickRoleImage = async (role: 'customer' | 'admin' | 'staff') => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { showAlert('Permission needed', 'Allow photo library access to pick an image.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      await AsyncStorage.setItem(ROLE_IMG_KEYS[role], uri);
      setRoleImgs(prev => ({ ...prev, [role]: uri }));
    }
  };

  const removeRoleImage = async (role: 'customer' | 'admin' | 'staff') => {
    await AsyncStorage.removeItem(ROLE_IMG_KEYS[role]);
    setRoleImgs(prev => ({ ...prev, [role]: '' }));
  };
  const [seeding, setSeeding] = useState(false);
  const [btDevices, setBtDevices] = useState<BluetoothDevice[]>([]);
  const [connectedPrinter, setConnectedPrinter] = useState<string>('');
  const [scanningBt, setScanningBt] = useState(false);

  // Pre-fill form from context settings
  useEffect(() => {
    setHotelName(settings.hotelName || '');
    setOwnerName(settings.ownerName || '');
    setBusinessType(settings.businessType || 'both');
    setAddress(settings.address || '');
    setPhone(settings.phone || '');
    setEmail(settings.email || '');
    setFssaiNumber(settings.fssaiNumber || '');
    setGstNumber(settings.gstNumber || '');
    setPanNumber(settings.panNumber || '');
    setBankName(settings.bankName || '');
    setBankAccountHolder(settings.bankAccountHolder || '');
    setBankAccountNumber(settings.bankAccountNumber || '');
    setBankIfscCode(settings.bankIfscCode || '');
    setUpiId(settings.upiId || '');
    setDefaultTaxPercent(String(settings.defaultTaxPercent || 5));
    setPrinterWidth(settings.printerWidth || '80mm');
    setFooterText(settings.footerText || '');
    setKitchenPin((settings as any).kitchenPin || '');
  }, [settings]);

  // Load stored API base URL and printer
  useEffect(() => {
    const loadStored = async () => {
      try {
        const storedUrl = await AsyncStorage.getItem(API_URL_STORAGE_KEY);
        if (storedUrl) setApiBaseUrl(storedUrl);
        const storedPrinter = await AsyncStorage.getItem(BT_PRINTER_KEY);
        if (storedPrinter) setConnectedPrinter(storedPrinter);
      } catch {}
    };
    loadStored();
  }, []);

  const handleScanPrinters = async () => {
    try {
      setScanningBt(true);
      const devices = await getPairedDevices();
      if (devices.length === 0) {
        showAlert('No Printers Found', 'Pair your Bluetooth printer in Android Bluetooth settings first, then try again.');
        return;
      }
      setBtDevices(devices);
    } catch (e: any) {
      if (e.message === BT_PERMISSION_DENIED) {
        Alert.alert(
          'Permission Required',
          'Nearby devices permission is needed to scan for Bluetooth printers.\n\nTap "Open Settings" → Permissions → Nearby devices → Allow.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else {
        showAlert('Bluetooth Error', e.message || 'Could not scan for printers');
      }
    } finally {
      setScanningBt(false);
    }
  };

  const handleConnectPrinter = async (device: BluetoothDevice) => {
    try {
      await connectPrinter(device.address);
      await AsyncStorage.setItem(BT_PRINTER_KEY, device.name + ' (' + device.address + ')');
      await AsyncStorage.setItem(BT_PRINTER_ADDRESS_KEY, device.address);
      setConnectedPrinter(device.name + ' (' + device.address + ')');
      setBtDevices([]);
      showAlert('Connected', device.name + ' is ready to print');
    } catch (e: any) {
      showAlert('Connection Failed', e.message || 'Could not connect to printer');
    }
  };

  const handleSeedDemoData = async () => {
    showAlert(
      'Load Demo Data',
      'This will add 7 categories and 21 sample dishes to your menu. Safe to run — skips if data already exists.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load Data',
          onPress: async () => {
            setSeeding(true);
            try {
              const result: any = await seedData();
              if (result.alreadySeeded) {
                showAlert('Already Loaded', 'Demo data is already in your menu.');
              } else {
                showAlert('Done!', `${result.data?.categories} categories and ${result.data?.products} dishes added to your menu.`);
              }
            } catch (e: any) {
              showAlert('Error', e.message || 'Failed to load demo data');
            } finally {
              setSeeding(false);
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    const taxNum = parseFloat(defaultTaxPercent);
    if (isNaN(taxNum) || taxNum < 0 || taxNum > 100) {
      showAlert('Validation Error', 'Tax percent must be between 0 and 100');
      return;
    }

    try {
      setSaving(true);

      // Save API URL to AsyncStorage
      if (apiBaseUrl.trim()) {
        await AsyncStorage.setItem(API_URL_STORAGE_KEY, apiBaseUrl.trim());
        clearApiUrlCache();
      }

      // Save settings to backend
      await saveSettings({
        hotelName: hotelName.trim(),
        ownerName: ownerName.trim(),
        businessType,
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        fssaiNumber: fssaiNumber.trim(),
        gstNumber: gstNumber.trim(),
        panNumber: panNumber.trim(),
        bankName: bankName.trim(),
        bankAccountHolder: bankAccountHolder.trim(),
        bankAccountNumber: bankAccountNumber.trim(),
        bankIfscCode: bankIfscCode.trim().toUpperCase(),
        upiId: upiId.trim(),
        defaultTaxPercent: taxNum,
        printerWidth,
        footerText: footerText.trim(),
        kitchenPin: kitchenPin.trim(),
      });

      showAlert('Success', 'Settings saved successfully');
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };


  const handleRegisterOnPlatform = async () => {
    if (!settings.phone?.trim()) {
      showAlert('Required', 'Please save your phone number first before registering');
      return;
    }
    if (!settings.fssaiNumber?.trim()) {
      showAlert('Required', 'FSSAI number is required for platform registration');
      return;
    }
    setRegistering(true);
    try {
      await registerHotel({
        hotelName: settings.hotelName,
        ownerName: settings.ownerName,
        businessType: settings.businessType,
        phone: settings.phone,
        email: settings.email,
        address: settings.address,
        fssaiNumber: settings.fssaiNumber,
        gstNumber: settings.gstNumber,
        panNumber: settings.panNumber,
        bankName: settings.bankName,
        bankAccountHolder: settings.bankAccountHolder,
        bankAccountNumber: settings.bankAccountNumber,
        bankIfscCode: settings.bankIfscCode,
        upiId: settings.upiId,
      });
      showAlert('Submitted!', 'Your hotel has been registered on the platform. Awaiting super admin approval.');
    } catch (error: any) {
      if (error.message?.includes('already registered')) {
        showAlert('Already Registered', 'This hotel is already registered on the platform.');
      } else {
        showAlert('Error', error.message || 'Registration failed');
      }
    } finally {
      setRegistering(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.xxl * 3 + bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Role Card Appearance */}
        <Text style={styles.sectionHeader}>Role Card Appearance</Text>
        <View style={styles.section}>
          <Text style={[styles.label, { marginBottom: Spacing.md }]}>
            Tap a card to change its image. Shown on the login role selector screen.
          </Text>
          {([
            { role: 'customer' as const, label: 'Customer',       emoji: '👤' },
            { role: 'admin'    as const, label: 'Business Admin',  emoji: '👨‍💼' },
            { role: 'staff'    as const, label: 'Staff Login',     emoji: '👥' },
          ]).map(({ role, label, emoji }) => (
            <View key={role} style={styles.roleImgRow}>
              <TouchableOpacity style={styles.roleImgThumb} onPress={() => pickRoleImage(role)} activeOpacity={0.8}>
                {roleImgs[role] ? (
                  <Image source={{ uri: roleImgs[role] }} style={styles.roleImgPreview} resizeMode="cover" />
                ) : (
                  <Text style={{ fontSize: 28 }}>{emoji}</Text>
                )}
                <View style={styles.roleImgEditBadge}>
                  <MaterialIcons name="edit" size={11} color={Colors.white} />
                </View>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.roleImgLabel}>{label}</Text>
                <Text style={styles.roleImgSub}>{roleImgs[role] ? 'Custom image set' : 'Using default emoji'}</Text>
              </View>
              {roleImgs[role] ? (
                <TouchableOpacity onPress={() => removeRoleImage(role)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name="close" size={20} color={Colors.danger} />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>

        {/* Hotel Info Section */}
        <Text style={styles.sectionHeader}>Hotel Information</Text>
        <View style={styles.section}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Hotel Name</Text>
            <TextInput
              style={styles.input}
              value={hotelName}
              onChangeText={setHotelName}
              placeholder="Enter hotel name"
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Address</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={address}
              onChangeText={setAddress}
              placeholder="Enter full address"
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={2}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="Enter phone number"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Enter email address"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Owner Name</Text>
            <TextInput
              style={styles.input}
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="Enter owner name"
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Business Type</Text>
            <View style={styles.toggleRow}>
              {(['veg', 'non-veg', 'both'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.toggleOption, businessType === type && styles.toggleOptionActive]}
                  onPress={() => setBusinessType(type)}
                >
                  <Text style={styles.toggleEmoji}>
                    {type === 'veg' ? '🌿' : type === 'non-veg' ? '🍗' : '🍽'}
                  </Text>
                  <Text style={[styles.toggleText, businessType === type && styles.toggleTextActive]}>
                    {type === 'veg' ? 'Veg' : type === 'non-veg' ? 'Non-Veg' : 'Both'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Legal Section */}
        <Text style={styles.sectionHeader}>Legal & Licenses</Text>
        <View style={styles.section}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>FSSAI License Number</Text>
            <TextInput
              style={styles.input}
              value={fssaiNumber}
              onChangeText={setFssaiNumber}
              placeholder="14-digit FSSAI number"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              maxLength={14}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>GST Number</Text>
            <TextInput
              style={styles.input}
              value={gstNumber}
              onChangeText={setGstNumber}
              placeholder="15-character GSTIN"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              maxLength={15}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>PAN Number</Text>
            <TextInput
              style={styles.input}
              value={panNumber}
              onChangeText={setPanNumber}
              placeholder="10-character PAN"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              maxLength={10}
            />
          </View>
        </View>

        {/* Bank Section */}
        <Text style={styles.sectionHeader}>Bank Details</Text>
        <View style={styles.section}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Bank Name</Text>
            <TextInput
              style={styles.input}
              value={bankName}
              onChangeText={setBankName}
              placeholder="e.g. State Bank of India"
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Account Holder Name</Text>
            <TextInput
              style={styles.input}
              value={bankAccountHolder}
              onChangeText={setBankAccountHolder}
              placeholder="As per bank records"
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Account Number</Text>
            <TextInput
              style={styles.input}
              value={bankAccountNumber}
              onChangeText={setBankAccountNumber}
              placeholder="Bank account number"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>IFSC Code</Text>
            <TextInput
              style={styles.input}
              value={bankIfscCode}
              onChangeText={setBankIfscCode}
              placeholder="e.g. SBIN0001234"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              maxLength={11}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>UPI ID</Text>
            <TextInput
              style={styles.input}
              value={upiId}
              onChangeText={setUpiId}
              placeholder="e.g. 9876543210@upi"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>
        </View>

        {/* Tax Section */}
        <Text style={styles.sectionHeader}>Tax Configuration</Text>
        <View style={styles.section}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Default Tax Percent (%)</Text>
            <TextInput
              style={styles.input}
              value={defaultTaxPercent}
              onChangeText={setDefaultTaxPercent}
              placeholder="e.g. 5"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        {/* Printer Section */}
        <Text style={styles.sectionHeader}>Printer Settings</Text>
        <View style={styles.section}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Printer Width</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[
                  styles.toggleOption,
                  printerWidth === '58mm' && styles.toggleOptionActive,
                ]}
                onPress={() => setPrinterWidth('58mm')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.toggleText,
                    printerWidth === '58mm' && styles.toggleTextActive,
                  ]}
                >
                  58mm
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleOption,
                  printerWidth === '80mm' && styles.toggleOptionActive,
                ]}
                onPress={() => setPrinterWidth('80mm')}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.toggleText,
                    printerWidth === '80mm' && styles.toggleTextActive,
                  ]}
                >
                  80mm
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Receipt Section */}
        <Text style={styles.sectionHeader}>Receipt</Text>
        <View style={styles.section}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Footer Text</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={footerText}
              onChangeText={setFooterText}
              placeholder="Thank you! Visit again!"
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={2}
            />
          </View>
        </View>

        {/* Bluetooth Printer Section */}
        <Text style={styles.sectionHeader}>Bluetooth Printer</Text>
        <View style={styles.section}>
          {connectedPrinter ? (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Connected Printer</Text>
              <Text style={{ color: Colors.success, fontSize: FontSize.md, marginBottom: Spacing.md }}>{connectedPrinter}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.platformBtn}
            onPress={handleScanPrinters}
            disabled={scanningBt}
            activeOpacity={0.7}
          >
            {scanningBt ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <>
                <MaterialIcons name="bluetooth-searching" size={20} color={Colors.white} />
                <Text style={styles.platformBtnText}>
                  {connectedPrinter ? 'Change Printer' : 'Select Printer'}
                </Text>
              </>
            )}
          </TouchableOpacity>
          {btDevices.length > 0 && (
            <View style={{ marginTop: Spacing.md }}>
              <Text style={styles.label}>Select Your Printer</Text>
              {btDevices.map((device) => (
                <TouchableOpacity
                  key={device.address}
                  style={styles.printerItem}
                  onPress={() => handleConnectPrinter(device)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="print" size={20} color={Colors.primary} />
                  <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                    <Text style={{ color: Colors.text, fontSize: FontSize.md, fontWeight: '600' }}>{device.name}</Text>
                    <Text style={{ color: Colors.textMuted, fontSize: FontSize.sm }}>{device.address}</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={Colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Kitchen PIN Section */}
        <Text style={styles.sectionHeader}>Kitchen Display</Text>
        <View style={styles.section}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Kitchen PIN</Text>
            <TextInput
              style={styles.input}
              value={kitchenPin}
              onChangeText={v => setKitchenPin(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="4–6 digit PIN for kitchen staff"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              maxLength={6}
              secureTextEntry
            />
            <Text style={styles.hint}>
              Kitchen staff enter this PIN to access the Kitchen Display (KDS)
            </Text>
          </View>
        </View>

        {/* Waiter Management */}
        <Text style={styles.sectionHeader}>Waiter Management</Text>
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.navRow}
            onPress={() => navigation.navigate('WaiterManagement' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.navRowLeft}>
              <View style={[styles.navRowIcon, { backgroundColor: Colors.accentBg }]}>
                <Text style={{ fontSize: 18 }}>🛎️</Text>
              </View>
              <View>
                <Text style={styles.navRowTitle}>Manage Waiters</Text>
                <Text style={styles.navRowSub}>Add, edit, remove waiter accounts</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Cashier Management */}
        <Text style={styles.sectionHeader}>Cashier Management</Text>
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.navRow}
            onPress={() => navigation.navigate('CashierManagement' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.navRowLeft}>
              <View style={[styles.navRowIcon, { backgroundColor: Colors.infoBg }]}>
                <Text style={{ fontSize: 18 }}>💰</Text>
              </View>
              <View>
                <Text style={styles.navRowTitle}>Manage Cashiers</Text>
                <Text style={styles.navRowSub}>Add, edit, remove cashier accounts</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* API Section */}
        <Text style={styles.sectionHeader}>Server Connection</Text>
        <View style={styles.section}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>API Base URL</Text>
            <TextInput
              style={styles.input}
              value={apiBaseUrl}
              onChangeText={setApiBaseUrl}
              placeholder="http://192.168.1.100:5000/api"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.hint}>
              Change requires app restart to take effect
            </Text>
          </View>
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.7}
        >
          {saving ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.saveButtonText}>Save Settings</Text>
          )}
        </TouchableOpacity>

        {/* Demo Data Section */}
        <View style={styles.seedSection}>
          <Text style={styles.sectionHeader}>Demo Data</Text>
          <View style={styles.section}>
            <Text style={styles.seedDescription}>
              Load 7 categories and 21 sample menu items to test your POS quickly. You can delete them later from Products.
            </Text>
            <TouchableOpacity
              style={[styles.platformBtn, { backgroundColor: Colors.warning }]}
              onPress={handleSeedDemoData}
              disabled={seeding}
              activeOpacity={0.7}
            >
              {seeding ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <>
                  <MaterialIcons name="restaurant-menu" size={20} color={Colors.white} />
                  <Text style={styles.platformBtnText}>Load Demo Menu Data</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Restaurant Tools Section */}
        <View style={styles.seedSection}>
          <Text style={styles.sectionHeader}>Restaurant Tools</Text>
          <View style={styles.section}>
            {[
              { label: 'Table Layout', sub: 'Manage floor map & table status', icon: 'table-restaurant' as const, nav: 'TableLayout' as const },
              { label: 'Reservations', sub: 'View & manage table bookings', icon: 'event-available' as const, nav: 'Reservations' as const },
              { label: 'Expenses & P&L', sub: 'Track costs and profit/loss', icon: 'account-balance-wallet' as const, nav: 'Expenses' as const },
              { label: 'QR Ordering Menu', sub: 'Generate QR codes for tables', icon: 'qr-code' as const, nav: 'QRMenu' as const },
            ].map((item) => (
              <TouchableOpacity
                key={item.nav}
                style={styles.toolRow}
                onPress={() => navigation.navigate(item.nav as any)}
                activeOpacity={0.7}
              >
                <View style={styles.toolIconWrap}>
                  <MaterialIcons name={item.icon} size={22} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toolLabel}>{item.label}</Text>
                  <Text style={styles.toolSub}>{item.sub}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Platform Section */}
        <View style={styles.seedSection}>
          <Text style={styles.sectionHeader}>Platform</Text>
          <View style={styles.section}>
            <Text style={styles.seedDescription}>
              Register your hotel on the SaaS platform to get monitored and supported by the super admin.
            </Text>
            <TouchableOpacity
              style={styles.platformBtn}
              onPress={handleRegisterOnPlatform}
              disabled={registering}
              activeOpacity={0.7}
            >
              {registering ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <>
                  <MaterialIcons name="cloud-upload" size={20} color={Colors.white} />
                  <Text style={styles.platformBtnText}>Register on Platform</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.supportBtn}
              onPress={() => navigation.navigate('Support')}
              activeOpacity={0.7}
            >
              <MaterialIcons name="support-agent" size={20} color={Colors.info} />
              <Text style={styles.supportBtnText}>Customer Support / Raise Ticket</Text>
              <MaterialIcons name="chevron-right" size={20} color={Colors.info} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Logout */}
        <View style={styles.seedSection}>
          <Text style={styles.sectionHeader}>Account</Text>
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() =>
                showAlert('Logout', 'Are you sure you want to logout?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Logout',
                    style: 'destructive',
                    onPress: async () => { clearCart(); await logout(); },
                  },
                ])
              }
              activeOpacity={0.7}
            >
              <MaterialIcons name="logout" size={20} color={Colors.white} />
              <Text style={styles.logoutBtnText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textSecondary,
    marginTop: Spacing.md,
    fontSize: FontSize.md,
  },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: FontSize.xxl,
    fontWeight: 'bold',
    color: Colors.text,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
  },
  sectionHeader: {
    fontSize: FontSize.lg,
    fontWeight: 'bold',
    color: Colors.primary,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  section: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fieldGroup: {
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '600',
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    color: Colors.text,
    fontSize: FontSize.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
    fontStyle: 'italic',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  toggleOption: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
    minHeight: 68,
  },
  toggleOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryBg,
  },
  toggleEmoji: {
    fontSize: 22,
    marginBottom: 3,
  },
  toggleText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
  toggleTextActive: {
    color: Colors.primary,
    fontWeight: 'bold',
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    marginTop: Spacing.xxl,
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  printerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  logoutBtn: {
    backgroundColor: Colors.danger,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  logoutBtnText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: 'bold',
  },
  seedSection: {
    marginTop: Spacing.lg,
  },
  seedDescription: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },
  seedButton: {
    backgroundColor: Colors.warning,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  seedButtonText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: 'bold',
  },
  platformBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  platformBtnText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: 'bold',
  },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.info,
  },
  supportBtnText: {
    flex: 1,
    color: Colors.info,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: Spacing.md,
  },
  toolIconWrap: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
  },
  toolSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  roleImgRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  roleImgThumb: {
    width: 60, height: 60, borderRadius: BorderRadius.md,
    backgroundColor: Colors.background, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  roleImgPreview: { width: 60, height: 60, borderRadius: BorderRadius.md },
  roleImgEditBadge: {
    position: 'absolute', bottom: -4, right: -4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.surface,
  },
  roleImgLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  roleImgSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },

  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  navRowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  navRowIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  navRowTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  navRowSub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
});

export default SettingsScreen;
