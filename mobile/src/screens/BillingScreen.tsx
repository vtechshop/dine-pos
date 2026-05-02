import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, TextInput, ActivityIndicator, Dimensions,
  Modal, Image, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { showAlert } from '../utils/alert';
import { useCart, DiscountType } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';
import { Category, Product } from '../types';
import { Colors, Spacing, FontSize, BorderRadius, Shadows, UPI_ID, UPI_NAME } from '../utils/constants';
import { enqueueOrder, flushQueue } from '../utils/offlineQueue';

const { width: SW } = Dimensions.get('window');
const IS_TABLET = SW >= 768;
const CAT_W = IS_TABLET ? 100 : 76;
const CART_W = IS_TABLET ? 340 : SW;
const COLS = IS_TABLET ? 3 : 2;

type PayMethod = 'cash' | 'upi' | 'card' | 'split';

const PAY_OPTIONS: { id: PayMethod; label: string; icon: any; color: string; bg: string }[] = [
  { id: 'cash',  label: 'Cash',  icon: 'payments',     color: Colors.cash,        bg: Colors.cashBg },
  { id: 'upi',   label: 'UPI',   icon: 'qr-code',      color: Colors.upi,         bg: Colors.upiBg },
  { id: 'card',  label: 'Card',  icon: 'credit-card',  color: Colors.cardPayment, bg: Colors.cardBg },
  { id: 'split', label: 'Split', icon: 'call-split',   color: Colors.split,       bg: Colors.splitBg },
];

// Order success modal state
interface OrderSuccess { orderNumber: string; grandTotal: number; token: string }

const BillingScreen: React.FC = () => {
  const {
    cart, addItem, removeItem, increment, decrement, clearCart,
    itemCount, setCustomer, setTable, setNotes, setParcel, setDiscount,
  } = useCart();
  const { settings } = useSettings();

  const [categories,        setCategories]       = useState<Category[]>([]);
  const [products,          setProducts]         = useState<Product[]>([]);
  const [filtered,          setFiltered]         = useState<Product[]>([]);
  const [selectedCat,       setSelectedCat]      = useState<string | null>(null);
  const [payMethod,         setPayMethod]        = useState<PayMethod>('cash');
  const [loading,           setLoading]          = useState(true);
  const [placing,           setPlacing]          = useState(false);
  const [search,            setSearch]           = useState('');
  const [showCart,          setShowCart]         = useState(IS_TABLET);
  const [showPayModal,      setShowPayModal]     = useState(false);
  const [discountInput,     setDiscountInput]    = useState('');
  const [discountType,      setDiscountType]     = useState<DiscountType>('percent');
  const [showSuccess,       setShowSuccess]      = useState<OrderSuccess | null>(null);
  const [showUpiQr,         setShowUpiQr]        = useState(false);
  const [customerPhone,     setCustomerPhone]    = useState('');

  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${n.toFixed(2)}`;
  const isMaterialIcon = (name?: string) => !!name && /^[a-z0-9-_]+$/.test(name);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [cats, prods] = await Promise.all([api.getCategories(), api.getProducts()]);
      setCategories(cats);
      setProducts(prods);
      setFiltered(prods);
      setSelectedCat(null);
    } catch {
      showAlert('Error', 'Failed to load menu. Check server connection.');
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const handleCategorySelect = useCallback((catId: string | null) => {
    setSelectedCat(catId);
    if (!catId) { setFiltered(products); return; }
    setFiltered(products.filter(p => {
      const id = typeof p.category === 'string' ? p.category : p.category?._id;
      return id === catId;
    }));
  }, [products]);

  useEffect(() => {
    if (!search.trim()) { handleCategorySelect(selectedCat); return; }
    setFiltered(products.filter(p => p.name.toLowerCase().includes(search.toLowerCase())));
  }, [search]);

  const applyDiscount = () => {
    const val = parseFloat(discountInput) || 0;
    setDiscount({ type: discountType, value: val });
  };

  const buildUpiUrl = (amount: number) => {
    const upiId  = settings.upiId || UPI_ID;
    const name   = encodeURIComponent(settings.hotelName || UPI_NAME);
    const am     = amount.toFixed(2);
    return `upi://pay?pa=${upiId}&pn=${name}&am=${am}&cu=INR`;
  };

  const sendWhatsApp = (order: OrderSuccess) => {
    if (!customerPhone.trim()) { showAlert('Phone Missing', 'Enter customer phone number first.'); return; }
    const phone = customerPhone.replace(/\D/g, '');
    const items = cart.items.map(i => `  ${i.product.name} x${i.quantity} — ${cur}${(i.product.price * i.quantity).toFixed(0)}`).join('\n');
    const msg =
`*${settings.hotelName || 'Restaurant'} — Digital Bill*
Order: ${order.orderNumber}
Token: #${order.token}
---
${items}
---
Subtotal: ${cur}${cart.subtotal.toFixed(2)}
Tax: ${cur}${cart.taxTotal.toFixed(2)}
${cart.discountAmount > 0 ? `Discount: -${cur}${cart.discountAmount.toFixed(2)}\n` : ''}*Total: ${cur}${order.grandTotal.toFixed(2)}*
---
Thank you for dining with us!`;
    const url = `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`;
    Linking.openURL(url).catch(() => showAlert('Error', 'Could not open WhatsApp'));
  };

  const handlePlaceOrder = () => {
    if (cart.items.length === 0) { showAlert('Empty Cart', 'Add items first.'); return; }
    applyDiscount();
    setShowPayModal(true);
  };

  const confirmOrder = async () => {
    setShowPayModal(false);
    setPlacing(true);
    const orderData = {
      items: cart.items.map(item => ({
        product: item.product._id,
        productName: item.product.name,
        quantity: item.quantity,
        price: item.product.price,
        taxPercent: item.product.taxPercent,
        taxAmount: item.taxAmount,
        total: item.total,
      })),
      subtotal:      cart.subtotal,
      taxTotal:      cart.taxTotal,
      grandTotal:    cart.grandTotal,
      discountAmount:cart.discountAmount,
      paymentMethod: payMethod,
      status:        'pending' as const,
      tableNumber:   cart.isParcel ? 'Parcel' : cart.tableNumber,
      customerName:  cart.customerName,
      notes:         cart.notes,
      isParcel:      cart.isParcel,
    };
    try {
      // Try server first; on network failure queue offline
      let order: any;
      try {
        order = await api.createOrder(orderData);
        // Also flush any previously queued orders
        flushQueue(api.createOrder);
      } catch (netErr: any) {
        const offlineId = await enqueueOrder(orderData);
        const tokenNum = `Q${offlineId.slice(-3).toUpperCase()}`;
        setShowSuccess({ orderNumber: `OFFLINE-${tokenNum}`, grandTotal: cart.grandTotal, token: tokenNum });
        showAlert('Saved Offline', 'No server connection. Order queued and will sync when online.');
        clearCart();
        setDiscountInput('');
        setDiscount({ type: 'percent', value: 0 });
        return;
      }
      const tokenNum = order.orderNumber.split('-').pop() || '1';
      setShowSuccess({ orderNumber: order.orderNumber, grandTotal: order.grandTotal, token: tokenNum });
      clearCart();
      setDiscountInput('');
      setDiscount({ type: 'percent', value: 0 });
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to place order');
    } finally { setPlacing(false); }
  };

  // ── Category button ──────────────────────────────────────────────────────
  const renderCat = (cat: Category | null) => {
    const active = cat ? selectedCat === cat._id : selectedCat === null;
    return (
      <TouchableOpacity
        key={cat?._id || 'all'}
        style={[styles.catBtn, active && styles.catBtnActive]}
        onPress={() => handleCategorySelect(cat?._id || null)}
      >
        {isMaterialIcon(cat?.icon)
          ? <MaterialIcons name={cat!.icon as any} size={22} color={active ? Colors.primary : Colors.textSecondary} />
          : cat?.icon
            ? <Text style={{ fontSize: 18, lineHeight: 22 }}>{cat.icon}</Text>
            : <MaterialIcons name="apps" size={22} color={active ? Colors.primary : Colors.textSecondary} />
        }
        <Text style={[styles.catText, active && styles.catTextActive]} numberOfLines={2}>
          {cat?.name || 'All'}
        </Text>
      </TouchableOpacity>
    );
  };

  // ── Product card ──────────────────────────────────────────────────────────
  const renderProduct = ({ item }: { item: Product }) => {
    const qty = cart.items.find(i => i.product._id === item._id)?.quantity || 0;
    return (
      <TouchableOpacity style={styles.prodCard} onPress={() => addItem(item)} activeOpacity={0.75}>
        {/* Veg/NonVeg indicator */}
        <View style={[styles.vegBox, { borderColor: item.isVeg ? Colors.veg : Colors.nonVeg }]}>
          <View style={[styles.vegDot, { backgroundColor: item.isVeg ? Colors.veg : Colors.nonVeg }]} />
        </View>

        {item.image
          ? <Image source={{ uri: item.image }} style={styles.prodImg} resizeMode="cover" />
          : <View style={styles.prodImgPlaceholder}><MaterialIcons name="fastfood" size={28} color={Colors.textMuted} /></View>
        }

        <View style={styles.prodInfo}>
          <Text style={styles.prodName} numberOfLines={2}>{item.name}</Text>
          <View style={styles.prodPriceRow}>
            <Text style={styles.prodPrice}>{cur}{item.price.toFixed(0)}</Text>
            {item.taxPercent > 0 && <Text style={styles.prodGst}>{item.taxPercent}%</Text>}
          </View>
        </View>

        {/* Qty badge */}
        {qty > 0 && (
          <View style={styles.qtyBadge}>
            <Text style={styles.qtyBadgeText}>{qty}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // ── Cart item ─────────────────────────────────────────────────────────────
  const renderCartItem = ({ item }: { item: typeof cart.items[0] }) => (
    <View style={styles.cartItem}>
      <View style={styles.cartItemLeft}>
        <View style={[styles.vegBoxTiny, { borderColor: item.product.isVeg ? Colors.veg : Colors.nonVeg }]}>
          <View style={[styles.vegDotTiny, { backgroundColor: item.product.isVeg ? Colors.veg : Colors.nonVeg }]} />
        </View>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.cartItemName} numberOfLines={1}>{item.product.name}</Text>
          <Text style={styles.cartItemUnitPrice}>{cur}{item.product.price.toFixed(0)} each</Text>
        </View>
      </View>
      <View style={styles.cartItemRight}>
        <Text style={styles.cartItemTotal}>{cur}{(item.product.price * item.quantity).toFixed(0)}</Text>
        <View style={styles.qtyRow}>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => decrement(item.product._id)}>
            <MaterialIcons name="remove" size={15} color={Colors.white} />
          </TouchableOpacity>
          <Text style={styles.qtyNum}>{item.quantity}</Text>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => increment(item.product._id)}>
            <MaterialIcons name="add" size={15} color={Colors.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.removeBtn} onPress={() => removeItem(item.product._id)}>
            <MaterialIcons name="close" size={14} color={Colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loaderText}>Loading menu...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Header / Search ── */}
      <View style={styles.header}>
        <View style={styles.searchWrap}>
          <MaterialIcons name="search" size={20} color={Colors.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search items..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <MaterialIcons name="close" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        {!IS_TABLET && (
          <TouchableOpacity style={[styles.cartToggle, itemCount > 0 && styles.cartToggleActive]} onPress={() => setShowCart(!showCart)}>
            <MaterialIcons name="shopping-cart" size={22} color={itemCount > 0 ? Colors.white : Colors.textSecondary} />
            {itemCount > 0 && <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{itemCount}</Text></View>}
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.body}>
        {/* ── Categories ── */}
        {(IS_TABLET || !showCart) && (
          <ScrollView style={styles.catList} showsVerticalScrollIndicator={false}>
            {renderCat(null)}
            {categories.map(c => renderCat(c))}
          </ScrollView>
        )}

        {/* ── Product Grid ── */}
        {(IS_TABLET || !showCart) && (
          <FlatList
            data={filtered}
            renderItem={renderProduct}
            keyExtractor={i => i._id}
            numColumns={COLS}
            style={{ flex: 1 }}
            contentContainerStyle={styles.prodGrid}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <MaterialIcons name="restaurant" size={48} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No items found</Text>
              </View>
            }
          />
        )}

        {/* ── Cart Panel ── */}
        {(IS_TABLET || showCart) && (
          <View style={[styles.cartPanel, !IS_TABLET && { width: '100%' }]}>
            {/* Cart header */}
            <View style={styles.cartHeader}>
              <Text style={styles.cartTitle}>Current Order</Text>
              <View style={styles.cartHeaderRight}>
                {/* Parcel toggle */}
                <TouchableOpacity
                  style={[styles.parcelToggle, cart.isParcel && styles.parcelToggleActive]}
                  onPress={() => setParcel(!cart.isParcel)}
                >
                  <MaterialIcons name={cart.isParcel ? 'local-mall' : 'restaurant'} size={15} color={cart.isParcel ? Colors.white : Colors.textSecondary} />
                  <Text style={[styles.parcelText, cart.isParcel && { color: Colors.white }]}>
                    {cart.isParcel ? 'Parcel' : 'Dine In'}
                  </Text>
                </TouchableOpacity>
                {!IS_TABLET && (
                  <TouchableOpacity onPress={() => setShowCart(false)} style={{ padding: 4 }}>
                    <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Customer / Table */}
            <View style={styles.customerRow}>
              <View style={[styles.custInput, { flex: 1, marginRight: 6 }]}>
                <MaterialIcons name="person-outline" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.custInputText}
                  placeholder="Customer"
                  placeholderTextColor={Colors.textMuted}
                  value={cart.customerName}
                  onChangeText={setCustomer}
                />
              </View>
              {!cart.isParcel && (
                <View style={[styles.custInput, { width: 90 }]}>
                  <MaterialIcons name="grid-on" size={16} color={Colors.textMuted} />
                  <TextInput
                    style={styles.custInputText}
                    placeholder="Table"
                    placeholderTextColor={Colors.textMuted}
                    value={cart.tableNumber}
                    onChangeText={setTable}
                    keyboardType="number-pad"
                  />
                </View>
              )}
            </View>
            {/* Phone (for WhatsApp bill) */}
            <View style={[styles.customerRow, { paddingTop: 0 }]}>
              <View style={[styles.custInput, { flex: 1 }]}>
                <MaterialIcons name="phone" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.custInputText}
                  placeholder="Phone (WhatsApp bill)"
                  placeholderTextColor={Colors.textMuted}
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            {/* Cart items */}
            <FlatList
              data={cart.items}
              renderItem={renderCartItem}
              keyExtractor={i => i.product._id}
              style={{ flex: 1 }}
              ListEmptyComponent={
                <View style={styles.emptyCart}>
                  <MaterialIcons name="add-shopping-cart" size={36} color={Colors.textMuted} />
                  <Text style={styles.emptyCartText}>Tap items to add</Text>
                </View>
              }
            />

            {/* Discount row */}
            {cart.items.length > 0 && (
              <View style={styles.discountRow}>
                <View style={styles.discountTypeToggle}>
                  <TouchableOpacity
                    style={[styles.discTypeBtn, discountType === 'percent' && styles.discTypeBtnActive]}
                    onPress={() => setDiscountType('percent')}
                  >
                    <Text style={[styles.discTypeTxt, discountType === 'percent' && { color: Colors.white }]}>%</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.discTypeBtn, discountType === 'flat' && styles.discTypeBtnActive]}
                    onPress={() => setDiscountType('flat')}
                  >
                    <Text style={[styles.discTypeTxt, discountType === 'flat' && { color: Colors.white }]}>{cur}</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.discountInput}
                  placeholder="Discount"
                  placeholderTextColor={Colors.textMuted}
                  value={discountInput}
                  onChangeText={setDiscountInput}
                  keyboardType="decimal-pad"
                  onEndEditing={applyDiscount}
                />
              </View>
            )}

            {/* Note */}
            {cart.items.length > 0 && (
              <View style={styles.noteRow}>
                <MaterialIcons name="notes" size={15} color={Colors.textMuted} />
                <TextInput
                  style={styles.noteInput}
                  placeholder="Order note (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={cart.notes}
                  onChangeText={setNotes}
                />
              </View>
            )}

            {/* Totals */}
            <View style={styles.totals}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal</Text>
                <Text style={styles.totalVal}>{fmt(cart.subtotal)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tax (GST)</Text>
                <Text style={styles.totalVal}>{fmt(cart.taxTotal)}</Text>
              </View>
              {cart.discountAmount > 0 && (
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: Colors.success }]}>Discount</Text>
                  <Text style={[styles.totalVal, { color: Colors.success }]}>−{fmt(cart.discountAmount)}</Text>
                </View>
              )}
              <View style={[styles.totalRow, styles.grandRow]}>
                <Text style={styles.grandLabel}>TOTAL</Text>
                <Text style={styles.grandVal}>{fmt(cart.grandTotal)}</Text>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.cartActions}>
              <TouchableOpacity style={styles.clearBtn} onPress={() => { if (cart.items.length) showAlert('Clear?', 'Remove all items?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: clearCart }]); }}>
                <MaterialIcons name="delete-outline" size={20} color={Colors.danger} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.placeBtn, (cart.items.length === 0 || placing) && styles.placeBtnDisabled]}
                onPress={handlePlaceOrder}
                disabled={placing || cart.items.length === 0}
                activeOpacity={0.85}
              >
                {placing
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <><MaterialIcons name="check-circle" size={20} color={Colors.white} /><Text style={styles.placeBtnText}>Place Order</Text></>
                }
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* ── Payment Modal ── */}
      <Modal visible={showPayModal} transparent animationType="slide" onRequestClose={() => setShowPayModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.payModal}>
            <View style={styles.payModalHandle} />
            <Text style={styles.payModalTitle}>Choose Payment</Text>
            <Text style={styles.payModalAmount}>{fmt(cart.grandTotal)}</Text>

            <View style={styles.payGrid}>
              {PAY_OPTIONS.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.payCard, payMethod === p.id && { borderColor: p.color, backgroundColor: p.bg }]}
                  onPress={() => setPayMethod(p.id)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.payIconWrap, { backgroundColor: payMethod === p.id ? p.color + '25' : Colors.surface }]}>
                    <MaterialIcons name={p.icon} size={28} color={payMethod === p.id ? p.color : Colors.textSecondary} />
                  </View>
                  <Text style={[styles.payLabel, payMethod === p.id && { color: p.color }]}>{p.label}</Text>
                  {payMethod === p.id && (
                    <MaterialIcons name="check-circle" size={16} color={p.color} style={styles.payCheck} />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.payActions}>
              <TouchableOpacity style={styles.payCancel} onPress={() => setShowPayModal(false)}>
                <Text style={styles.payCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.payConfirm} onPress={confirmOrder} activeOpacity={0.85}>
                <Text style={styles.payConfirmText}>Confirm Order</Text>
                <MaterialIcons name="arrow-forward" size={18} color={Colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── UPI QR Modal ── */}
      <Modal visible={showUpiQr} transparent animationType="fade" onRequestClose={() => setShowUpiQr(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.successModal, { paddingVertical: Spacing.xxl }]}>
            <Text style={styles.successTitle}>Scan & Pay</Text>
            <Text style={[styles.successOrderNum, { marginBottom: Spacing.xl }]}>
              {cur}{showSuccess?.grandTotal.toFixed(2) || cart.grandTotal.toFixed(2)}
            </Text>
            <View style={{ padding: Spacing.lg, backgroundColor: Colors.white, borderRadius: BorderRadius.xl }}>
              <QRCode
                value={buildUpiUrl(showSuccess?.grandTotal || cart.grandTotal)}
                size={200}
                color={Colors.text}
                backgroundColor={Colors.white}
              />
            </View>
            <Text style={[styles.successOrderNum, { marginTop: Spacing.lg }]}>
              {settings.upiId || UPI_ID}
            </Text>
            <TouchableOpacity
              style={[styles.successDoneBtn, { width: '100%', marginTop: Spacing.xl }]}
              onPress={() => setShowUpiQr(false)}
            >
              <Text style={styles.successDoneText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Order Success / Token Modal ── */}
      <Modal visible={!!showSuccess} transparent animationType="fade" onRequestClose={() => setShowSuccess(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.successModal}>
            <View style={styles.successIconWrap}>
              <MaterialIcons name="check-circle" size={56} color={Colors.success} />
            </View>
            <Text style={styles.successTitle}>Order Placed!</Text>
            <Text style={styles.successOrderNum}>{showSuccess?.orderNumber}</Text>
            {/* Big Token */}
            <View style={styles.tokenBox}>
              <Text style={styles.tokenLabel}>TOKEN NUMBER</Text>
              <Text style={styles.tokenNumber}>#{showSuccess?.token}</Text>
            </View>
            <Text style={styles.successAmount}>{cur}{showSuccess?.grandTotal.toFixed(2)}</Text>
            {/* WhatsApp + UPI QR row */}
            <View style={styles.successActions}>
              <TouchableOpacity
                style={[styles.successPrintBtn, { flex: 1 }]}
                onPress={() => { if (showSuccess) sendWhatsApp(showSuccess); }}
              >
                <MaterialIcons name="chat" size={18} color={Colors.success} />
                <Text style={[styles.successPrintText, { color: Colors.success }]}>WhatsApp</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.successPrintBtn, { flex: 1 }]}
                onPress={() => setShowUpiQr(true)}
              >
                <MaterialIcons name="qr-code" size={18} color={Colors.upi} />
                <Text style={[styles.successPrintText, { color: Colors.upi }]}>UPI QR</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.successDoneBtn, { width: '100%', marginTop: 8 }]} onPress={() => { setShowSuccess(null); setCustomerPhone(''); }}>
              <Text style={styles.successDoneText}>New Order</Text>
              <MaterialIcons name="add" size={18} color={Colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.background },
  loader:     { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  loaderText: { color: Colors.textSecondary, marginTop: Spacing.md, fontSize: FontSize.md },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: FontSize.md, color: Colors.text },
  cartToggle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  cartToggleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  cartBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: Colors.danger, borderRadius: 10,
    width: 18, height: 18, alignItems: 'center', justifyContent: 'center',
  },
  cartBadgeText: { color: Colors.white, fontSize: 9, fontWeight: '800' },

  body: { flex: 1, flexDirection: 'row' },

  // Categories
  catList: { width: CAT_W, backgroundColor: Colors.surface, borderRightWidth: 1, borderRightColor: Colors.border },
  catBtn: { alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: Colors.border },
  catBtnActive: { backgroundColor: Colors.primaryBg, borderLeftWidth: 3, borderLeftColor: Colors.primary },
  catText: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 4, textAlign: 'center', lineHeight: 13 },
  catTextActive: { color: Colors.primary, fontWeight: '700' },

  // Product grid
  prodGrid: { padding: Spacing.sm, paddingBottom: 20 },
  prodCard: {
    flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    margin: Spacing.xs, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border,
    maxWidth: IS_TABLET ? '31%' : '48%',
  },
  vegBox: { position: 'absolute', top: 6, right: 6, zIndex: 10, width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  vegDot: { width: 7, height: 7, borderRadius: 3.5 },
  prodImg: { width: '100%', height: 80 },
  prodImgPlaceholder: { width: '100%', height: 80, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  prodInfo: { padding: Spacing.sm, paddingBottom: Spacing.md },
  prodName: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600', marginBottom: 4, lineHeight: 16 },
  prodPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prodPrice: { color: Colors.primary, fontSize: FontSize.lg, fontWeight: '800' },
  prodGst: { color: Colors.textMuted, fontSize: FontSize.xs },
  qtyBadge: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: Colors.primary, borderRadius: 10, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  qtyBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '800' },

  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.md, marginTop: Spacing.md },

  // Cart
  cartPanel: { width: CART_W, backgroundColor: Colors.surface, borderLeftWidth: 1, borderLeftColor: Colors.border },
  cartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cartTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '800' },
  cartHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  parcelToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: BorderRadius.round, backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  parcelToggleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  parcelText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },

  customerRow: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 6 },
  custInput: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm, borderWidth: 1, borderColor: Colors.border, gap: 5,
  },
  custInputText: { flex: 1, paddingVertical: 9, fontSize: FontSize.sm, color: Colors.text },

  cartItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cartItemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  vegBoxTiny: { width: 11, height: 11, borderRadius: 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  vegDotTiny: { width: 5, height: 5, borderRadius: 2.5 },
  cartItemName: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600' },
  cartItemUnitPrice: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 1 },
  cartItemRight: { alignItems: 'flex-end' },
  cartItemTotal: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700', marginBottom: 4 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  qtyBtn: { backgroundColor: Colors.elevated, borderRadius: 6, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  qtyNum: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  removeBtn: { padding: 4 },
  emptyCart: { alignItems: 'center', paddingVertical: 32 },
  emptyCartText: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 8 },

  // Discount
  discountRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  discountTypeToggle: { flexDirection: 'row', borderRadius: BorderRadius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  discTypeBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.card },
  discTypeBtnActive: { backgroundColor: Colors.primary },
  discTypeTxt: { color: Colors.textSecondary, fontWeight: '700', fontSize: FontSize.md },
  discountInput: {
    flex: 1, backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 9,
    color: Colors.text, fontSize: FontSize.md,
    borderWidth: 1, borderColor: Colors.border,
  },

  // Note
  noteRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.md, marginBottom: Spacing.sm, backgroundColor: Colors.card, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: 6 },
  noteInput: { flex: 1, paddingVertical: 9, fontSize: FontSize.sm, color: Colors.text },

  // Totals
  totals: { borderTopWidth: 1, borderTopColor: Colors.border, padding: Spacing.md },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  totalLabel: { color: Colors.textSecondary, fontSize: FontSize.md },
  totalVal: { color: Colors.text, fontSize: FontSize.md },
  grandRow: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  grandLabel: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800' },
  grandVal: { color: Colors.primary, fontSize: FontSize.xxl, fontWeight: '900' },

  // Cart actions
  cartActions: { flexDirection: 'row', padding: Spacing.md, gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  clearBtn: { width: 48, height: 48, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.dangerBg, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.dangerBg },
  placeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.success, borderRadius: BorderRadius.lg, paddingVertical: 13, gap: 8, ...Shadows.success },
  placeBtnDisabled: { opacity: 0.45 },
  placeBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },

  // Payment modal
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  payModal: { backgroundColor: Colors.card, borderTopLeftRadius: BorderRadius.xxxl, borderTopRightRadius: BorderRadius.xxxl, padding: Spacing.xxl, paddingBottom: 36, borderWidth: 1, borderColor: Colors.border },
  payModalHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  payModalTitle: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  payModalAmount: { color: Colors.primary, fontSize: FontSize.xxxl, fontWeight: '900', textAlign: 'center', marginBottom: Spacing.xxl },
  payGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginBottom: Spacing.xl },
  payCard: {
    width: '47%', backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, alignItems: 'center', borderWidth: 2, borderColor: Colors.border,
  },
  payIconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  payLabel: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '700' },
  payCheck: { position: 'absolute', top: 8, right: 8 },
  payActions: { flexDirection: 'row', gap: Spacing.md },
  payCancel: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  payCancelText: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: '600' },
  payConfirm: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.success, paddingVertical: 14, borderRadius: BorderRadius.lg, gap: 8, ...Shadows.success },
  payConfirmText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },

  // Success modal
  successModal: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.xxxl, padding: Spacing.xxl,
    marginHorizontal: Spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
    ...Shadows.lg,
  },
  successIconWrap: { marginBottom: Spacing.lg },
  successTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  successOrderNum: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xl },
  tokenBox: {
    backgroundColor: Colors.successBg, borderRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.xxxl, paddingVertical: Spacing.xl,
    alignItems: 'center', marginBottom: Spacing.lg,
    borderWidth: 2, borderColor: Colors.success + '40',
    width: '100%',
  },
  tokenLabel: { fontSize: FontSize.xs, color: Colors.success, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 },
  tokenNumber: { fontSize: FontSize.hero, fontWeight: '900', color: Colors.success },
  successAmount: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: Spacing.xl },
  successActions: { flexDirection: 'row', gap: Spacing.md, width: '100%' },
  successPrintBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.primary,
  },
  successPrintText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },
  successDoneBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: BorderRadius.lg, backgroundColor: Colors.primary, ...Shadows.primary,
  },
  successDoneText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
});

export default BillingScreen;
