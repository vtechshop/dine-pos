import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, Linking, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import QRCode from 'react-native-qrcode-svg';

import { RootStackParamList, Order } from '../types';
import { useSettings } from '../context/SettingsContext';
import { useCart } from '../context/CartContext';
import {
  createOrder,
  cancelOrderAdmin,
  completeOrderPayment,
  completeOrderWithDetails,
  PaymentDetails,
} from '../services/api';
import { getPendingOrder, clearPendingOrder } from '../utils/paymentBridge';
import { printReceipt } from '../utils/receipt';
import { printKOT } from '../utils/receipt';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

type PayMethod = 'cash' | 'upi_intent' | 'upi_qr' | 'upi_collect' | 'card' | 'split';

interface SplitEntry {
  mode: 'cash' | 'upi_intent' | 'upi_qr' | 'upi_collect' | 'card';
  amount: string;
  transactionId: string;
}

const METHODS: Array<{ key: PayMethod; label: string; icon: keyof typeof MaterialIcons.glyphMap; color: string }> = [
  { key: 'cash',        label: 'Cash',       icon: 'payments',     color: '#2E7D32' },
  { key: 'upi_intent',  label: 'UPI Intent', icon: 'smartphone',   color: '#1565C0' },
  { key: 'upi_qr',      label: 'UPI QR',     icon: 'qr-code-2',    color: '#6A1B9A' },
  { key: 'upi_collect', label: 'UPI Collect', icon: 'send',         color: '#E65100' },
  { key: 'card',        label: 'Card',        icon: 'credit-card',  color: '#00695C' },
  { key: 'split',       label: 'Split',       icon: 'call-split',   color: '#C62828' },
];

const UPI_APPS = [
  { name: 'Google Pay', short: 'GPay',   scheme: 'tez://upi/pay',     pkg: 'com.google.android.apps.nbu.paisa.user', color: '#4285F4' },
  { name: 'PhonePe',   short: 'PhonePe', scheme: 'phonepe://pay',     pkg: 'com.phonepe.app',                       color: '#5F259F' },
  { name: 'Paytm',     short: 'Paytm',   scheme: 'paytmmp://pay',     pkg: 'net.one97.paytm',                       color: '#00BAF2' },
  { name: 'BHIM',      short: 'BHIM',    scheme: 'upi://pay',         pkg: 'in.org.npci.upiapp',                    color: '#FF6D00' },
  { name: 'Amazon Pay', short: 'Amazon', scheme: 'amazonpay://',      pkg: 'in.amazon.mShop.android.shopping',      color: '#FF9900' },
  { name: 'Any App',   short: 'Any UPI', scheme: 'upi://pay',         pkg: '',                                      color: '#546E7A' },
];

type Props = NativeStackScreenProps<RootStackParamList, 'PaymentScreen'>;

// ─── Component ────────────────────────────────────────────────────────────────

const PaymentScreen: React.FC<Props> = ({ navigation, route }) => {
  const { mode, orderId, orderNumber, grandTotal } = route.params;
  const { settings } = useSettings();
  const { clearCart } = useCart();
  const { top } = useSafeAreaInsets();

  const [method, setMethod]       = useState<PayMethod>('cash');
  const [placing, setPlacing]     = useState(false);

  // UPI Intent state
  const [selectedApp, setSelectedApp]   = useState('');
  const [upiLaunched, setUpiLaunched]   = useState(false);
  const launchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // UPI Collect state
  const [collectUpiId, setCollectUpiId]     = useState('');
  const [collectSent, setCollectSent]       = useState(false);

  // UPI QR state
  const [txnId, setTxnId] = useState('');

  // Card state
  const [cardTxnId, setCardTxnId] = useState('');

  // Split state
  const [splits, setSplits] = useState<SplitEntry[]>([
    { mode: 'cash',       amount: '',  transactionId: '' },
    { mode: 'upi_intent', amount: '',  transactionId: '' },
    { mode: 'card',       amount: '',  transactionId: '' },
  ]);

  // Billing mode: order data from bridge
  const pendingOrderRef = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (mode === 'billing') {
      pendingOrderRef.current = getPendingOrder();
    }
    return () => { clearPendingOrder(); };
  }, [mode]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const upiString = useCallback((amount: number, ref: string) => {
    const pa  = encodeURIComponent(settings.upiId || '');
    const pn  = encodeURIComponent(settings.hotelName || 'DinePOS');
    const am  = amount.toFixed(2);
    const tn  = encodeURIComponent(`DinePOS-${ref}`);
    return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR&tn=${tn}`;
  }, [settings.upiId, settings.hotelName]);

  const orderRef = orderNumber || orderId || 'ORD';

  const splitTotal = splits.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const splitRemaining = grandTotal - splitTotal;

  // ── UPI Intent launch ──────────────────────────────────────────────────────

  const launchUpi = async (app: typeof UPI_APPS[0]) => {
    if (!settings.upiId) {
      Alert.alert('UPI Not Configured', 'Add your UPI ID in Settings → Payment.');
      return;
    }
    setSelectedApp(app.name);
    setUpiLaunched(false);
    const url = upiString(grandTotal, orderRef);
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert('App Not Found', `${app.name} is not installed. Try "Any App".`);
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('Cannot Open', 'Failed to launch UPI app. Check your UPI ID in Settings.');
      return;
    }
    // After 1.5 s show Mark Paid / Failed buttons
    launchTimerRef.current = setTimeout(() => setUpiLaunched(true), 1500);
  };

  useEffect(() => () => {
    if (launchTimerRef.current) clearTimeout(launchTimerRef.current);
  }, []);

  // ── Split row helpers ──────────────────────────────────────────────────────

  const updateSplit = (idx: number, field: keyof SplitEntry, val: string) => {
    setSplits(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));
  };

  const splitLabel = (m: SplitEntry['mode']): string => {
    const map: Record<SplitEntry['mode'], string> = {
      cash: 'Cash', upi_intent: 'UPI', upi_qr: 'UPI QR', upi_collect: 'UPI Collect', card: 'Card',
    };
    return map[m];
  };

  // ── Confirm handler ────────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (placing) return;
    if (method === 'upi_intent' && !upiLaunched) return;

    // Validate
    if (method === 'split') {
      if (Math.abs(splitRemaining) > 1) {
        Alert.alert('Split Mismatch', `Remaining ₹${splitRemaining.toFixed(2)} must be ₹0.`);
        return;
      }
    }
    if (method === 'upi_collect' && !collectUpiId.trim()) {
      Alert.alert('UPI ID Required', 'Enter the customer UPI ID.');
      return;
    }
    if (!settings.upiId && (method === 'upi_intent' || method === 'upi_qr' || method === 'upi_collect')) {
      Alert.alert('UPI Not Configured', 'Add your hotel UPI ID in Settings → Payment before accepting UPI.');
      return;
    }

    const details: PaymentDetails = {};
    if (method === 'upi_intent') {
      details.upiApp = selectedApp || 'UPI Intent';
      if (txnId.trim()) details.transactionId = txnId.trim();
    }
    if (method === 'upi_qr') {
      if (txnId.trim()) details.transactionId = txnId.trim();
    }
    if (method === 'card') {
      if (cardTxnId.trim()) details.transactionId = cardTxnId.trim();
    }
    if (method === 'upi_collect') {
      details.upiApp = collectUpiId.trim();
      if (txnId.trim()) details.transactionId = txnId.trim();
    }
    if (method === 'split') {
      const activeSplits = splits.filter(e => parseFloat(e.amount) > 0);
      details.payments = activeSplits.map(e => ({
        mode:          e.mode,
        amount:        parseFloat(e.amount),
        transactionId: e.transactionId.trim() || undefined,
      }));
      details.splitDetails = {
        cash: parseFloat(splits.find(s => s.mode === 'cash')?.amount || '0') || 0,
        upi:  parseFloat(splits.find(s => s.mode === 'upi_intent')?.amount || '0') || 0,
        card: parseFloat(splits.find(s => s.mode === 'card')?.amount || '0') || 0,
      };
    }

    setPlacing(true);
    try {
      let completedOrder: Order | null = null;

      if (mode === 'billing') {
        // Create order, then confirm payment. KOT only fires on payment success.
        const payload = pendingOrderRef.current;
        if (!payload) throw new Error('Order data missing. Go back and retry.');
        const created = await createOrder({ ...payload, paymentMethod: method } as Parameters<typeof createOrder>[0]);
        try {
          completedOrder = await completeOrderWithDetails(created._id, method, details);
        } catch (payErr) {
          // Payment confirmation failed — cancel the just-created order so it does not orphan
          cancelOrderAdmin(created._id).catch(() => {});
          throw payErr;
        }
        // KOT fires only after payment is confirmed — never on a failed payment
        printKOT(created, settings).catch(() => {});
      } else {
        // Cashier completing an existing order
        await completeOrderPayment(orderId!, method, details);
        completedOrder = null; // receipt uses local copy from CashierDashboard
      }

      // Print receipt
      if (completedOrder) {
        printReceipt(completedOrder, settings).catch(() => {});
      }

      // Clear cart in billing mode
      if (mode === 'billing') clearCart();

      // Navigate
      if (mode === 'billing') {
        navigation.replace('RoleSelect');
      } else {
        navigation.goBack(); // cashier returns to dashboard, useFocusEffect refreshes orders
      }
    } catch (err: any) {
      Alert.alert('Payment Failed', err.message || 'Could not process payment. Try again.');
    } finally {
      setPlacing(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const active = METHODS.find(m => m.key === method)!;

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerAmount}>₹{grandTotal.toFixed(2)}</Text>
          {orderNumber ? <Text style={styles.headerOrder}>{orderNumber}</Text> : null}
        </View>
      </View>

      {/* Method tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
        style={styles.tabsScroll}
      >
        {METHODS.map(m => (
          <TouchableOpacity
            key={m.key}
            style={[styles.tab, method === m.key && { backgroundColor: m.color, borderColor: m.color }]}
            onPress={() => {
              setMethod(m.key);
              setUpiLaunched(false);
              setSelectedApp('');
              setCollectSent(false);
              setTxnId('');
            }}
            activeOpacity={0.8}
          >
            <MaterialIcons name={m.icon} size={18} color={method === m.key ? '#FFF' : Colors.textSecondary} />
            <Text style={[styles.tabText, method === m.key && styles.tabTextActive]}>{m.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

        {/* ── CASH ─────────────────────────────────────────────────── */}
        {method === 'cash' && (
          <View style={styles.card}>
            <MaterialIcons name="payments" size={48} color="#2E7D32" style={styles.bigIcon} />
            <Text style={styles.cardTitle}>Cash Payment</Text>
            <Text style={styles.cardAmt}>₹{grandTotal.toFixed(2)}</Text>
            <Text style={styles.cardHint}>Collect cash from customer and mark as paid.</Text>
          </View>
        )}

        {/* ── UPI INTENT ───────────────────────────────────────────── */}
        {method === 'upi_intent' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>UPI Intent</Text>
            <Text style={styles.cardAmt}>₹{grandTotal.toFixed(2)}</Text>
            {!upiLaunched ? (
              <>
                <Text style={styles.cardHint}>Select the customer's UPI app to open payment:</Text>
                <View style={styles.appGrid}>
                  {UPI_APPS.map(app => (
                    <TouchableOpacity
                      key={app.name}
                      style={[styles.appBtn, selectedApp === app.name && styles.appBtnSelected, { borderColor: app.color }]}
                      onPress={() => launchUpi(app)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.appIcon, { backgroundColor: app.color + '20' }]}>
                        <Text style={[styles.appIconText, { color: app.color }]}>
                          {app.short.slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.appName}>{app.short}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.afterLaunch}>
                <Text style={styles.cardHint}>
                  Opened <Text style={{ fontWeight: '700' }}>{selectedApp}</Text> for ₹{grandTotal.toFixed(2)}.
                  {'\n'}Did the customer complete payment?
                </Text>
                <TextInput
                  style={styles.txnInput}
                  placeholder="UPI Transaction ID (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={txnId}
                  onChangeText={setTxnId}
                  autoCapitalize="characters"
                />
                <TouchableOpacity style={styles.retryBtn} onPress={() => { setUpiLaunched(false); setSelectedApp(''); }}>
                  <Text style={styles.retryBtnText}>Try Another App</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ── UPI QR ───────────────────────────────────────────────── */}
        {method === 'upi_qr' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>UPI QR Code</Text>
            <Text style={styles.cardAmt}>₹{grandTotal.toFixed(2)}</Text>
            {settings.upiId ? (
              <>
                <View style={styles.qrBox}>
                  <QRCode
                    value={upiString(grandTotal, orderRef)}
                    size={200}
                    backgroundColor="#FFFFFF"
                  />
                </View>
                <Text style={styles.upiIdText}>{settings.upiId}</Text>
                <Text style={styles.cardHint}>Customer scans and pays. Verify in your UPI app before marking paid.</Text>
                <TextInput
                  style={styles.txnInput}
                  placeholder="UPI Transaction ID (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={txnId}
                  onChangeText={setTxnId}
                  autoCapitalize="characters"
                />
              </>
            ) : (
              <View style={styles.configWarn}>
                <MaterialIcons name="warning" size={28} color="#E65100" />
                <Text style={styles.configWarnText}>
                  UPI ID not set. Go to Settings → Payment and add your UPI ID.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── UPI COLLECT ──────────────────────────────────────────── */}
        {method === 'upi_collect' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>UPI Collect Request</Text>
            <Text style={styles.cardAmt}>₹{grandTotal.toFixed(2)}</Text>
            <Text style={styles.cardHint}>Enter the customer's UPI ID to send a collect request:</Text>
            <TextInput
              style={styles.txnInput}
              placeholder="customer@upi"
              placeholderTextColor={Colors.textMuted}
              value={collectUpiId}
              onChangeText={v => { setCollectUpiId(v); setCollectSent(false); }}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {!collectSent ? (
              <TouchableOpacity
                style={[styles.sendBtn, !collectUpiId.trim() && styles.sendBtnDisabled]}
                onPress={() => {
                  if (!collectUpiId.trim()) return;
                  setCollectSent(true);
                }}
                disabled={!collectUpiId.trim()}
                activeOpacity={0.8}
              >
                <MaterialIcons name="send" size={18} color="#FFF" />
                <Text style={styles.sendBtnText}>Send Collect Request</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.collectStatus}>
                <ActivityIndicator size="small" color="#1565C0" />
                <Text style={styles.collectStatusText}>
                  Request sent to <Text style={{ fontWeight: '700' }}>{collectUpiId}</Text>.
                  {'\n'}Ask customer to approve, then mark paid.
                </Text>
              </View>
            )}
            <TextInput
              style={[styles.txnInput, { marginTop: 12 }]}
              placeholder="UPI Transaction ID (optional)"
              placeholderTextColor={Colors.textMuted}
              value={txnId}
              onChangeText={setTxnId}
              autoCapitalize="characters"
            />
          </View>
        )}

        {/* ── CARD ─────────────────────────────────────────────────── */}
        {method === 'card' && (
          <View style={styles.card}>
            <MaterialIcons name="credit-card" size={48} color="#00695C" style={styles.bigIcon} />
            <Text style={styles.cardTitle}>Card Payment</Text>
            <Text style={styles.cardAmt}>₹{grandTotal.toFixed(2)}</Text>
            <Text style={styles.cardHint}>Swipe / tap card on your POS terminal.</Text>
            <TextInput
              style={styles.txnInput}
              placeholder="Card Approval / Transaction ID (optional)"
              placeholderTextColor={Colors.textMuted}
              value={cardTxnId}
              onChangeText={setCardTxnId}
              autoCapitalize="characters"
            />
          </View>
        )}

        {/* ── SPLIT ────────────────────────────────────────────────── */}
        {method === 'split' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Split Payment</Text>
            <Text style={styles.cardAmt}>Total: ₹{grandTotal.toFixed(2)}</Text>
            <Text style={styles.cardHint}>Enter amount for each payment method used:</Text>

            {splits.map((entry, idx) => (
              <View key={entry.mode} style={styles.splitRow}>
                <View style={styles.splitLabelBox}>
                  <Text style={styles.splitLabel}>{splitLabel(entry.mode)}</Text>
                </View>
                <View style={styles.splitInputWrap}>
                  <Text style={styles.splitRupee}>₹</Text>
                  <TextInput
                    style={styles.splitInput}
                    placeholder="0.00"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                    value={entry.amount}
                    onChangeText={v => updateSplit(idx, 'amount', v)}
                  />
                </View>
              </View>
            ))}

            <View style={[styles.remainingRow, Math.abs(splitRemaining) < 0.01 ? styles.remainingOk : styles.remainingErr]}>
              <Text style={styles.remainingLabel}>Remaining</Text>
              <Text style={styles.remainingAmt}>
                {Math.abs(splitRemaining) < 0.01 ? '₹0.00 ✓' : `₹${Math.abs(splitRemaining).toFixed(2)}`}
              </Text>
            </View>
          </View>
        )}

        {/* ── Confirm button ────────────────────────────────────────── */}
        <TouchableOpacity
          style={[
            styles.confirmBtn,
            { backgroundColor: active.color },
            (placing ||
              (method === 'split' && Math.abs(splitRemaining) > 1) ||
              (method === 'upi_intent' && !upiLaunched)
            ) && styles.confirmBtnDisabled,
          ]}
          onPress={handleConfirm}
          disabled={placing || (method === 'split' && Math.abs(splitRemaining) > 1) || (method === 'upi_intent' && !upiLaunched)}
          activeOpacity={0.85}
        >
          {placing ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <MaterialIcons name="check-circle" size={20} color="#FFF" />
              <Text style={styles.confirmBtnText}>
                {method === 'cash'        ? 'Mark as Paid — Cash' :
                 method === 'upi_intent'  ? (upiLaunched ? 'Customer Paid — Confirm' : 'Tap an app above to launch UPI') :
                 method === 'upi_qr'      ? 'Customer Paid via QR' :
                 method === 'upi_collect' ? 'Mark as Received' :
                 method === 'card'        ? 'Mark as Paid — Card' :
                                           'Confirm Split Payment'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: Colors.background ?? '#F5F5F5' },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, backgroundColor: Colors.surface, ...Shadows.sm },
  backBtn:     { padding: 4, marginRight: Spacing.md },
  headerInfo:  { flex: 1 },
  headerAmount:{ fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  headerOrder: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },

  tabsScroll:  { maxHeight: 56, flexGrow: 0 },
  tabsRow:     { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 8 },
  tab:         {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tabText:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: '#FFF' },

  body:        { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  card:        {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.xl, marginBottom: Spacing.lg, ...Shadows.md,
    alignItems: 'center',
  },
  bigIcon:     { marginBottom: Spacing.md },
  cardTitle:   { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  cardAmt:     { fontSize: FontSize.xxxl, fontWeight: '800', color: Colors.primary, marginBottom: Spacing.sm },
  cardHint:    { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.lg, lineHeight: 20 },

  // UPI Intent
  appGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', width: '100%' },
  appBtn:        {
    width: 76, alignItems: 'center', borderRadius: BorderRadius.md,
    borderWidth: 1.5, padding: 10, backgroundColor: Colors.surface,
  },
  appBtnSelected:{ backgroundColor: '#E8F5E9' },
  appIcon:       { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  appIconText:   { fontSize: 14, fontWeight: '800' },
  appName:       { fontSize: 10, fontWeight: '600', color: Colors.textSecondary, textAlign: 'center' },

  afterLaunch:   { width: '100%', alignItems: 'center' },
  retryBtn:      { paddingVertical: 8, paddingHorizontal: 20, borderRadius: BorderRadius.md, borderWidth: 1.5, borderColor: Colors.border, marginTop: Spacing.sm },
  retryBtnText:  { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },

  // UPI QR
  qrBox:         { padding: 16, backgroundColor: '#FFF', borderRadius: BorderRadius.lg, marginBottom: Spacing.md, ...Shadows.sm },
  upiIdText:     { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, marginBottom: 4 },

  // UPI Collect
  sendBtn:         { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1565C0', paddingVertical: 12, paddingHorizontal: 24, borderRadius: BorderRadius.md, marginTop: Spacing.sm },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText:     { color: '#FFF', fontWeight: '700', fontSize: FontSize.md },
  collectStatus:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: Spacing.md, backgroundColor: '#E3F2FD', padding: 12, borderRadius: BorderRadius.md },
  collectStatusText: { flex: 1, fontSize: FontSize.sm, color: '#1565C0', lineHeight: 20 },

  // Card
  txnInput:    {
    width: '100%', borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.md,
    fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.background ?? '#F5F5F5',
    marginTop: Spacing.sm,
  },
  configWarn:     { alignItems: 'center', gap: 8 },
  configWarnText: { textAlign: 'center', color: '#E65100', fontSize: FontSize.sm, lineHeight: 20 },

  // Split
  splitRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 10, width: '100%' },
  splitLabelBox:  { width: 90 },
  splitLabel:     { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  splitInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: 10 },
  splitRupee:     { fontSize: FontSize.md, color: Colors.textSecondary, marginRight: 4 },
  splitInput:     { flex: 1, fontSize: FontSize.md, color: Colors.text, paddingVertical: 10 },
  remainingRow:   { flexDirection: 'row', justifyContent: 'space-between', width: '100%', padding: 12, borderRadius: BorderRadius.md, marginTop: 8 },
  remainingOk:    { backgroundColor: '#E8F5E9' },
  remainingErr:   { backgroundColor: '#FFEBEE' },
  remainingLabel: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  remainingAmt:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  // Confirm
  confirmBtn:         {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderRadius: BorderRadius.lg, ...Shadows.md,
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText:     { color: '#FFF', fontSize: FontSize.lg, fontWeight: '800' },
});

export default PaymentScreen;
