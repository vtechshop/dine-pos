import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Image, ScrollView, useWindowDimensions,
  StatusBar, Modal, Linking, Platform, Vibration,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showAlert } from '../utils/alert';
import { useCart } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';
import { getStoredHotelId, enqueueCustomerOrder } from '../services/api';
import { isConnected } from '../sync/syncEngine';
import { RootStackParamList, CartItem, Order } from '../types';
import { printReceipt } from '../utils/receipt';
import { Colors, Spacing, FontSize, BorderRadius, Shadows, API_BASE_URL } from '../utils/constants';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const BACKEND_URL = API_BASE_URL.replace('/api', '');

interface PlacedOrder {
  _id: string;
  orderNumber: string;
  token: string;
  items: CartItem[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  customerName: string;
  customerPhone: string;
  tableNumber: string;
  notes: string;
  isOffline?: boolean;
}

const CustomerCartScreen: React.FC = () => {
  const { bottom } = useSafeAreaInsets();
  const { cart, increment, decrement, removeItem, setCustomer, setPhone, setTable, setNotes, clearCart, itemCount } = useCart();
  const { settings } = useSettings();
  const navigation = useNavigation<NavProp>();
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<PlacedOrder | null>(null);
  const [countdown, setCountdown] = useState(6);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { width } = useWindowDimensions();
  const isTablet = width >= 600;

  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${n.toFixed(0)}`;

  const billUrl = placedOrder ? `${BACKEND_URL}/bill/${placedOrder._id}` : '';

  // Auto-navigate back to menu after order placed (KFC style)
  useEffect(() => {
    if (!placedOrder) return;
    setCountdown(6);
    let count = 6;
    countdownRef.current = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count <= 0) {
        clearInterval(countdownRef.current!);
        setPlacedOrder(null);
        navigation.reset({ index: 0, routes: [{ name: 'CustomerTabs' }] });
      }
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [placedOrder?._id]);

  const handlePlaceOrder = async () => {
    if (cart.items.length === 0) { showAlert('Empty Cart', 'Add items from the menu first.'); return; }
    if (!cart.customerName.trim()) { showAlert('Name Required', 'Please enter your name.'); return; }

    const hotelId = await getStoredHotelId();
    if (!hotelId) { showAlert('Error', 'Hotel not found. Please scan the QR code again.'); return; }

    setPlacing(true);

    const orderPayload = {
      hotel: hotelId,
      source: 'dine-in' as const,
      orderSource: 'dine-in',
      items: cart.items.map(item => ({
        product: item.product._id,
        productName: item.product.name,
        quantity: item.quantity,
        price: item.product.price,
        taxPercent: item.product.taxPercent,
        taxAmount: item.taxAmount,
        total: item.total,
      })),
      tableNumber: cart.tableNumber,
      customerName: cart.customerName,
      notes: cart.notes,
      subtotal: cart.subtotal,
      taxTotal: cart.taxTotal,
      grandTotal: cart.grandTotal,
      paymentMethod: 'cash',
      status: 'pending',
    };

    // If offline — queue immediately, no API call needed
    if (!isConnected()) {
      const localToken = String(Math.floor(Math.random() * 90 + 10));
      await enqueueCustomerOrder(hotelId, localToken, orderPayload);
      clearCart();
      Vibration.vibrate([0, 100, 80, 300]);
      setPlacedOrder({
        _id: `offline_${Date.now()}`,
        orderNumber: `QUEUED-${localToken}`,
        token: localToken,
        items: [...cart.items],
        subtotal: cart.subtotal,
        taxTotal: cart.taxTotal,
        grandTotal: cart.grandTotal,
        customerName: cart.customerName,
        customerPhone: cart.customerPhone,
        tableNumber: cart.tableNumber,
        notes: cart.notes,
        isOffline: true,
      });
      setPlacing(false);
      return;
    }

    try {
      const order = await api.createPublicOrder(orderPayload);

      const token = order.orderNumber.split('-').pop() || '1';
      const snapshot = {
        _id: order._id,
        orderNumber: order.orderNumber,
        token,
        items: [...cart.items],
        subtotal: cart.subtotal,
        taxTotal: cart.taxTotal,
        grandTotal: cart.grandTotal,
        customerName: cart.customerName,
        customerPhone: cart.customerPhone,
        tableNumber: cart.tableNumber,
        notes: cart.notes,
      };
      clearCart();
      Vibration.vibrate([0, 100, 80, 300]);
      setPlacedOrder(snapshot);
      // Fire-and-forget auto-print — only if BT printer is configured
      (async () => {
        try {
          const savedPrinter = await AsyncStorage.getItem('@hotel_pos_bt_printer');
          if (!savedPrinter) return;
          await printReceipt({
            _id: snapshot._id,
            orderNumber: snapshot.orderNumber,
            items: snapshot.items.map(i => ({
              product: i.product._id,
              productName: i.product.name,
              quantity: i.quantity,
              price: i.product.price,
              taxPercent: i.product.taxPercent ?? 0,
              taxAmount: i.taxAmount,
              total: i.total,
            })),
            subtotal: snapshot.subtotal,
            taxTotal: snapshot.taxTotal,
            discountAmount: 0,
            grandTotal: snapshot.grandTotal,
            paymentMethod: 'cash',
            splitDetails: {},
            status: 'pending',
            orderSource: 'dine-in',
            isParcel: false,
            customerName: snapshot.customerName,
            customerPhone: snapshot.customerPhone,
            tableNumber: snapshot.tableNumber,
            notes: snapshot.notes,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as Order, settings);
        } catch { /* silent — print failure must not block order confirmation */ }
      })();
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to place order. Try again.');
    } finally { setPlacing(false); }
  };

  const handleWhatsApp = () => {
    if (!placedOrder) return;
    const itemLines = placedOrder.items
      .map(i => `• ${i.product.name} x${i.quantity} — ${cur}${i.total.toFixed(0)}`)
      .join('\n');
    const msg = `🍽 *Order Confirmed!*\n\n` +
      `Order: ${placedOrder.orderNumber}\n` +
      `Token: #${placedOrder.token}\n` +
      (placedOrder.tableNumber ? `Table: ${placedOrder.tableNumber}\n` : '') +
      `\n*Items:*\n${itemLines}\n\n` +
      `Subtotal: ${cur}${placedOrder.subtotal.toFixed(0)}\n` +
      `Tax: ${cur}${placedOrder.taxTotal.toFixed(0)}\n` +
      `*Total: ${cur}${placedOrder.grandTotal.toFixed(0)}*\n\n` +
      `View bill: ${billUrl}`;
    const phone = placedOrder.customerPhone.replace(/\D/g, '');
    const url = phone
      ? `whatsapp://send?phone=91${phone}&text=${encodeURIComponent(msg)}`
      : `whatsapp://send?text=${encodeURIComponent(msg)}`;
    Linking.openURL(url).catch(() => showAlert('WhatsApp not installed', 'Please share the bill link manually.'));
  };

  const renderItem = (item: CartItem) => (
    <View key={item.product._id} style={styles.cartItem}>
      {item.product.image
        ? <Image source={{ uri: item.product.image }} style={styles.itemImg} />
        : <View style={[styles.itemImg, styles.itemImgPlaceholder]}><MaterialIcons name="restaurant" size={22} color={Colors.textMuted} /></View>
      }
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={1}>{item.product.name}</Text>
        <Text style={styles.itemPrice}>{cur}{(item.product.price * item.quantity).toFixed(0)}</Text>
      </View>
      <View style={styles.qtyRow}>
        <TouchableOpacity style={styles.qtyBtn} onPress={() => decrement(item.product._id)}>
          <MaterialIcons name="remove" size={16} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.qtyNum}>{item.quantity}</Text>
        <TouchableOpacity style={styles.qtyBtn} onPress={() => increment(item.product._id)}>
          <MaterialIcons name="add" size={16} color={Colors.white} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => removeItem(item.product._id)} style={{ padding: 4 }}>
          <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Bill modal after order placed ─────────────────────────────────────────
  if (placedOrder) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
        <ScrollView contentContainerStyle={styles.billScroll} showsVerticalScrollIndicator={false}>
          {/* Success header */}
          <View style={styles.billHeader}>
            <MaterialIcons name="check-circle" size={60} color={Colors.success} />
            <Text style={styles.billSuccess}>Order Placed!</Text>
            <Text style={styles.billOrderNum}>{placedOrder.orderNumber}</Text>
          </View>

          {/* Offline queued notice */}
          {placedOrder.isOffline && (
            <View style={styles.offlineNotice}>
              <MaterialIcons name="wifi-off" size={16} color={Colors.warning} />
              <Text style={styles.offlineNoticeText}>
                You're offline — your order is saved and will reach the kitchen once connection is restored.
              </Text>
            </View>
          )}

          {/* Token */}
          <View style={[styles.tokenBox, placedOrder.isOffline && { backgroundColor: Colors.textSecondary }]}>
            <Text style={styles.tokenLabel}>YOUR TOKEN</Text>
            <Text style={styles.tokenNum}>#{placedOrder.token}</Text>
            {placedOrder.tableNumber ? <Text style={styles.tokenTable}>Table {placedOrder.tableNumber}</Text> : null}
          </View>

          {/* Items */}
          <View style={styles.billSection}>
            <Text style={styles.billSectionTitle}>Order Summary</Text>
            {placedOrder.items.map(item => (
              <View key={item.product._id} style={styles.billItemRow}>
                <Text style={styles.billItemName} numberOfLines={1}>{item.product.name}</Text>
                <Text style={styles.billItemQty}>x{item.quantity}</Text>
                <Text style={styles.billItemAmt}>{cur}{item.total.toFixed(0)}</Text>
              </View>
            ))}
            <View style={styles.billDivider} />
            <View style={styles.billTotalRow}>
              <Text style={styles.billTotalLabel}>Subtotal</Text>
              <Text style={styles.billTotalVal}>{fmt(placedOrder.subtotal)}</Text>
            </View>
            <View style={styles.billTotalRow}>
              <Text style={styles.billTotalLabel}>Tax (GST)</Text>
              <Text style={styles.billTotalVal}>{fmt(placedOrder.taxTotal)}</Text>
            </View>
            <View style={[styles.billTotalRow, styles.grandRow]}>
              <Text style={styles.grandLabel}>Total to Pay</Text>
              <Text style={styles.grandVal}>{fmt(placedOrder.grandTotal)}</Text>
            </View>
          </View>

          {/* QR Code */}
          <View style={styles.qrSection}>
            <Text style={styles.qrTitle}>Scan to view your bill</Text>
            <View style={styles.qrBox}>
              <QRCode value={billUrl} size={160} color={Colors.text} backgroundColor={Colors.white} />
            </View>
            <Text style={styles.qrHint}>Show this to staff or scan later</Text>
          </View>

          {/* Action buttons */}
          <View style={styles.billActions}>
            <TouchableOpacity style={styles.whatsappBtn} onPress={handleWhatsApp}>
              <MaterialIcons name="share" size={20} color={Colors.white} />
              <Text style={styles.whatsappBtnText}>Share on WhatsApp</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuBtn}
              onPress={() => {
                if (countdownRef.current) clearInterval(countdownRef.current);
                setPlacedOrder(null);
                navigation.reset({ index: 0, routes: [{ name: 'CustomerTabs' }] });
              }}
            >
              <MaterialIcons name="restaurant-menu" size={20} color={Colors.primary} />
              <Text style={styles.menuBtnText}>Back to Menu</Text>
              <View style={styles.countdownBadge}>
                <Text style={styles.countdownText}>{countdown}</Text>
              </View>
            </TouchableOpacity>
          </View>

          <Text style={styles.payNote}>💵 Please pay {fmt(placedOrder.grandTotal)} at the counter</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Your Order</Text>
          <Text style={styles.headerSub}>{itemCount} item{itemCount !== 1 ? 's' : ''} · {fmt(cart.grandTotal)}</Text>
        </View>
        {cart.items.length > 0 && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => showAlert('Clear Cart?', 'Remove all items?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Clear', style: 'destructive', onPress: clearCart },
            ])}
          >
            <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {cart.items.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <MaterialIcons name="shopping-cart" size={48} color={Colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>Cart is empty</Text>
          <Text style={styles.emptySub}>Go back and add items from the menu</Text>
        </View>
      ) : (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Items */}
            <View style={styles.section}>
              {cart.items.map(renderItem)}
            </View>

            {/* Your Details */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your Details</Text>

              {/* Name — required */}
              <View style={styles.inputWrap}>
                <MaterialIcons name="person-outline" size={18} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Your name *"
                  placeholderTextColor={Colors.textMuted}
                  value={cart.customerName}
                  onChangeText={setCustomer}
                />
              </View>

              {/* Phone — optional */}
              <View style={styles.inputWrap}>
                <MaterialIcons name="phone" size={18} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Phone number (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={cart.customerPhone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>

              {/* Table — optional */}
              <View style={styles.inputWrap}>
                <MaterialIcons name="grid-on" size={18} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Table number (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={cart.tableNumber}
                  onChangeText={setTable}
                  keyboardType="number-pad"
                />
              </View>

              {/* Notes — optional */}
              <View style={styles.inputWrap}>
                <MaterialIcons name="notes" size={18} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Special instructions (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={cart.notes}
                  onChangeText={setNotes}
                />
              </View>
            </View>

            {/* Bill Summary */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Bill Summary</Text>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Subtotal</Text>
                <Text style={styles.billVal}>{fmt(cart.subtotal)}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Tax (GST)</Text>
                <Text style={styles.billVal}>{fmt(cart.taxTotal)}</Text>
              </View>
              <View style={[styles.billRow, styles.grandRow]}>
                <Text style={styles.grandLabel}>Total to Pay</Text>
                <Text style={styles.grandVal}>{fmt(cart.grandTotal)}</Text>
              </View>
              <Text style={styles.payNote}>💵 Pay at counter after receiving order</Text>
            </View>
          </ScrollView>

          {/* Place order button */}
          <View style={[styles.bottomBar, { paddingBottom: Spacing.md + bottom }]}>
            <TouchableOpacity
              style={[styles.placeBtn, placing && { opacity: 0.7 }]}
              onPress={handlePlaceOrder}
              disabled={placing}
              activeOpacity={0.88}
            >
              {placing ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <View>
                    <Text style={styles.placeBtnText}>Place Order</Text>
                    <Text style={styles.placeBtnSub}>Pay {fmt(cart.grandTotal)} at counter</Text>
                  </View>
                  <MaterialIcons name="arrow-forward" size={22} color={Colors.white} />
                </>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl, paddingBottom: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  headerSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: BorderRadius.round, backgroundColor: Colors.dangerBg, borderWidth: 1, borderColor: Colors.danger + '30' },
  clearBtnText: { color: Colors.danger, fontSize: FontSize.sm, fontWeight: '700' },

  // Empty state
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  emptyIcon: { width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xl, borderWidth: 1, borderColor: Colors.border },
  emptyTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textSecondary, marginBottom: Spacing.sm },
  emptySub: { fontSize: FontSize.md, color: Colors.textMuted, textAlign: 'center' },

  // Section
  section: {
    backgroundColor: Colors.card, marginHorizontal: Spacing.md, marginTop: Spacing.md,
    borderRadius: BorderRadius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
  },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text, marginBottom: Spacing.md },

  // Cart items
  cartItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  itemImg: { width: 52, height: 52, borderRadius: 12 },
  itemImgPlaceholder: { backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  itemInfo: { flex: 1, marginHorizontal: Spacing.md },
  itemName: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },
  itemPrice: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '800', marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  qtyBtn: { backgroundColor: Colors.primary, borderRadius: 8, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  qtyNum: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '800', minWidth: 22, textAlign: 'center' },

  // Inputs
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: FontSize.md, color: Colors.text },

  // Bill summary (pre-order)
  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  billLabel: { color: Colors.textSecondary, fontSize: FontSize.md },
  billVal: { color: Colors.text, fontSize: FontSize.md },
  grandRow: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, marginBottom: Spacing.md },
  grandLabel: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '800' },
  grandVal: { color: Colors.primary, fontSize: FontSize.xxl, fontWeight: '900' },
  payNote: { color: Colors.textMuted, fontSize: FontSize.sm, textAlign: 'center', marginTop: 4 },

  // Bottom bar
  bottomBar: { padding: Spacing.lg, paddingBottom: Spacing.md, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border },
  placeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primary, paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.xl, ...Shadows.primary,
  },
  placeBtnText: { color: Colors.white, fontSize: FontSize.xl, fontWeight: '800' },
  placeBtnSub: { color: 'rgba(255,255,255,0.75)', fontSize: FontSize.xs, marginTop: 2 },

  // ── Bill screen (after order placed) ─────────────────────────────────────
  billScroll: { padding: Spacing.lg, paddingBottom: 40 },
  billHeader: { alignItems: 'center', paddingVertical: Spacing.xl },
  billSuccess: { fontSize: FontSize.xxxl, fontWeight: '900', color: Colors.text, marginTop: Spacing.sm },
  billOrderNum: { fontSize: FontSize.md, color: Colors.textSecondary, marginTop: 4 },

  offlineNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: BorderRadius.lg,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.warning + '40',
  },
  offlineNoticeText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  tokenBox: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.xxl,
    paddingVertical: Spacing.xxl, alignItems: 'center', marginBottom: Spacing.lg,
  },
  tokenLabel: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.75)', fontWeight: '800', letterSpacing: 3 },
  tokenNum: { fontSize: 72, fontWeight: '900', color: Colors.white, lineHeight: 80 },
  tokenTable: { fontSize: FontSize.md, color: 'rgba(255,255,255,0.85)', marginTop: 4, fontWeight: '600' },

  billSection: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md,
  },
  billSectionTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text, marginBottom: Spacing.md },
  billItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border },
  billItemName: { flex: 1, fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  billItemQty: { fontSize: FontSize.md, color: Colors.textSecondary, marginHorizontal: Spacing.md, minWidth: 30, textAlign: 'center' },
  billItemAmt: { fontSize: FontSize.md, color: Colors.primary, fontWeight: '800', minWidth: 60, textAlign: 'right' },
  billDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
  billTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  billTotalLabel: { fontSize: FontSize.md, color: Colors.textSecondary },
  billTotalVal: { fontSize: FontSize.md, color: Colors.text },

  // QR section
  qrSection: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.xl,
    padding: Spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md,
  },
  qrTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text, marginBottom: Spacing.lg },
  qrBox: {
    padding: Spacing.lg, backgroundColor: Colors.white,
    borderRadius: BorderRadius.xl, borderWidth: 1, borderColor: Colors.border,
  },
  qrHint: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.md, textAlign: 'center' },

  // Action buttons
  billActions: { gap: Spacing.md, marginBottom: Spacing.md },
  whatsappBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: '#25D366', borderRadius: BorderRadius.xl, paddingVertical: Spacing.lg,
    ...Shadows.sm,
  },
  whatsappBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
  menuBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, paddingVertical: Spacing.lg,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  menuBtnText: { color: Colors.primary, fontSize: FontSize.lg, fontWeight: '800' },
  countdownBadge: {
    backgroundColor: Colors.primary, borderRadius: 14, width: 28, height: 28,
    alignItems: 'center', justifyContent: 'center', marginLeft: 4,
  },
  countdownText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '900' },
});

export default CustomerCartScreen;
