import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Image, ScrollView, useWindowDimensions,
  StatusBar, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { showAlert } from '../utils/alert';
import { useCart } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';
import { RootStackParamList, CartItem } from '../types';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const CustomerCartScreen: React.FC = () => {
  const { cart, increment, decrement, removeItem, setCustomer, setTable, setNotes, clearCart, itemCount } = useCart();
  const { settings } = useSettings();
  const navigation = useNavigation<NavProp>();
  const [placing, setPlacing] = useState(false);
  const [tokenModal, setTokenModal] = useState<{ orderNumber: string; token: string } | null>(null);
  const { width } = useWindowDimensions();
  const isSmall = width < 360;

  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${n.toFixed(0)}`;

  const handlePlaceOrder = async () => {
    if (cart.items.length === 0) { showAlert('Empty Cart', 'Add items from the menu first.'); return; }
    if (!cart.customerName.trim()) { showAlert('Name Required', 'Please enter your name to continue.'); return; }
    if (!cart.tableNumber.trim()) { showAlert('Table Required', 'Please enter your table number.'); return; }

    setPlacing(true);
    try {
      const order = await api.createOrder({
        items: cart.items.map(item => ({
          product: item.product._id,
          productName: item.product.name,
          quantity: item.quantity,
          price: item.product.price,
          taxPercent: item.product.taxPercent,
          taxAmount: item.taxAmount,
          total: item.total,
        })),
        subtotal: cart.subtotal,
        taxTotal: cart.taxTotal,
        grandTotal: cart.grandTotal,
        paymentMethod: 'cash' as const,
        tableNumber: cart.tableNumber,
        customerName: cart.customerName,
        notes: cart.notes,
        status: 'pending' as const,
      });
      const token = order.orderNumber.split('-').pop() || '1';
      clearCart();
      setTokenModal({ orderNumber: order.orderNumber, token });
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to place order. Try again.');
    } finally { setPlacing(false); }
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
              <View style={styles.inputWrap}>
                <MaterialIcons name="grid-on" size={18} color={Colors.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Table number *"
                  placeholderTextColor={Colors.textMuted}
                  value={cart.tableNumber}
                  onChangeText={setTable}
                  keyboardType="number-pad"
                />
              </View>
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
          <View style={styles.bottomBar}>
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

      {/* Token number modal */}
      <Modal visible={!!tokenModal} transparent animationType="fade" onRequestClose={() => setTokenModal(null)}>
        <View style={styles.overlay}>
          <View style={styles.tokenModal}>
            <View style={styles.tokenSuccessIcon}>
              <MaterialIcons name="check-circle" size={56} color={Colors.success} />
            </View>
            <Text style={styles.tokenModalTitle}>Order Placed!</Text>
            <Text style={styles.tokenModalSub}>Show this token to collect your order</Text>

            <View style={styles.tokenDisplay}>
              <Text style={styles.tokenDisplayLabel}>TOKEN</Text>
              <Text style={styles.tokenDisplayNum}>#{tokenModal?.token}</Text>
              <Text style={styles.tokenDisplayOrder}>{tokenModal?.orderNumber}</Text>
            </View>

            <Text style={styles.tokenWait}>Please wait at your table. Staff will serve you shortly.</Text>

            <TouchableOpacity
              style={styles.tokenDoneBtn}
              onPress={() => {
                setTokenModal(null);
                navigation.reset({ index: 0, routes: [{ name: 'CustomerTabs' }] });
              }}
            >
              <MaterialIcons name="restaurant-menu" size={20} color={Colors.white} />
              <Text style={styles.tokenDoneText}>Back to Menu</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  // Bill
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

  // Overlay + token modal
  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  tokenModal: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.xxxl, padding: Spacing.xxl,
    width: '100%', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, ...Shadows.lg,
  },
  tokenSuccessIcon: { marginBottom: Spacing.lg },
  tokenModalTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  tokenModalSub: { fontSize: FontSize.md, color: Colors.textSecondary, marginBottom: Spacing.xl, textAlign: 'center' },
  tokenDisplay: {
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.xxl,
    paddingVertical: Spacing.xxl, paddingHorizontal: Spacing.xxxl + 8,
    alignItems: 'center', marginBottom: Spacing.lg,
    borderWidth: 2, borderColor: Colors.success + '40', width: '100%',
  },
  tokenDisplayLabel: { fontSize: FontSize.xs, color: Colors.success, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 },
  tokenDisplayNum: { fontSize: 72, fontWeight: '900', color: Colors.success, lineHeight: 80 },
  tokenDisplayOrder: { fontSize: FontSize.sm, color: Colors.success + 'AA', marginTop: 4, fontWeight: '600' },
  tokenWait: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xl, lineHeight: 20 },
  tokenDoneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, paddingVertical: 14, paddingHorizontal: Spacing.xxxl,
    borderRadius: BorderRadius.xl, width: '100%', ...Shadows.primary,
  },
  tokenDoneText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
});

export default CustomerCartScreen;
