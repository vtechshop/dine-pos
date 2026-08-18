import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, TextInput, ActivityIndicator, useWindowDimensions,
  Modal, Linking, Vibration, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { setPendingOrder } from '../utils/paymentBridge';
import { MaterialIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { showAlert } from '../utils/alert';
import { useCart, DiscountType } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';
import { Category, Product, Table } from '../types';
import { Colors, Spacing, FontSize, BorderRadius, Shadows, UPI_ID, UPI_NAME } from '../utils/constants';
import { applyCloudinaryTransform } from '../utils/cloudinary';
import { SelectedModifier, ModifierGroup } from '../types';
import RazorpayCheckout from 'react-native-razorpay';
import { getLocalCategories, getLocalProducts, saveCategories, saveProducts } from '../database/localCacheDao';
import { printKOT } from '../utils/receipt';
import { KOTOrderInput } from '../types';

const CAT_W  = 100; // tablet landscape vertical sidebar width
const CART_W = 340; // tablet landscape cart panel width

type OrderSource = 'dine-in' | 'takeaway' | 'swiggy' | 'zomato' | 'qr';

const SOURCE_OPTIONS: { id: OrderSource; label: string; emoji: string; color: string }[] = [
  { id: 'dine-in',  label: 'Dine In',  emoji: '🍴', color: Colors.primary },
  { id: 'takeaway', label: 'Takeaway', emoji: '🥡', color: Colors.warning },
  { id: 'swiggy',   label: 'Swiggy',   emoji: '🛵', color: '#FC8019' },
  { id: 'zomato',   label: 'Zomato',   emoji: '🍕', color: '#E23744' },
  { id: 'qr',       label: 'QR Order', emoji: '📲', color: Colors.upi },
];


interface OrderSuccess {
  orderNumber: string;
  grandTotal: number;
  token: string;
  subtotal: number;
  taxTotal: number;
  discountAmount: number;
  items: { name: string; qty: number; price: number }[];
  kot: KOTOrderInput;
}

const BillingScreen: React.FC = () => {
  const {
    cart, addItem, removeItem, increment, decrement, clearCart,
    itemCount, setCustomer, setTable, setNotes, setParcel, setDiscount,
  } = useCart();
  const { settings } = useSettings();
  const { bottom } = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { width: winW, height: winH } = useWindowDimensions();
  const isPortrait     = winH > winW;
  const IS_TABLET      = Math.max(winW, winH) >= 768;
  const tabletPortrait = IS_TABLET && isPortrait;
  const COLS           = IS_TABLET && !tabletPortrait ? 4 : (tabletPortrait ? 3 : 2);

  const [categories,        setCategories]       = useState<Category[]>([]);
  const [products,          setProducts]         = useState<Product[]>([]);
  const [filtered,          setFiltered]         = useState<Product[]>([]);
  const [selectedCat,       setSelectedCat]      = useState<string | null>(null);
  const [loading,           setLoading]          = useState(true);
  const [placing,           setPlacing]          = useState(false);
  const [search,            setSearch]           = useState('');
  const [showCart,          setShowCart]         = useState(IS_TABLET && !tabletPortrait);
  const [discountInput,     setDiscountInput]    = useState('');
  const [discountType,      setDiscountType]     = useState<DiscountType>('percent');
  const [showSuccess,       setShowSuccess]      = useState<OrderSuccess | null>(null);
  const [showUpiQr,         setShowUpiQr]        = useState(false);
  const [customerPhone,     setCustomerPhone]    = useState('');
  const [orderSource,       setOrderSource]      = useState<OrderSource>('dine-in');
  const [printingKot,       setPrintingKot]      = useState(false);
  const [tables,            setTables]           = useState<Table[]>([]);
  const [showTablePicker,     setShowTablePicker]    = useState(false);
  const [tableSearch,         setTableSearch]        = useState('');
  const [variantPickerProduct, setVariantPickerProduct] = useState<Product | null>(null);
  const [modifierPicker, setModifierPicker] = useState<{ product: Product; effectivePrice: number; variantId?: string; variantName?: string } | null>(null);
  const [modSelections, setModSelections] = useState<Record<string, string[]>>({});

  // Promo state
  const [couponCode,     setCouponCode]     = useState('');
  const [appliedCoupon,  setAppliedCoupon]  = useState<{ couponId: string; code: string; discountAmount: number; description: string } | null>(null);
  const [couponLoading,  setCouponLoading]  = useState(false);
  const [voucherCode,    setVoucherCode]    = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState<{ voucherCode: string; balance: number; redeemAmount: number } | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [walletInfo,     setWalletInfo]     = useState<{ customerId: string; walletBalance: number } | null>(null);
  const [useWallet,      setUseWallet]      = useState(false);

  const openModifiersOrAdd = (product: Product, effectivePrice: number, variantId?: string, variantName?: string) => {
    const mgs = (product.modifierGroups || []).filter(g => g.isActive);
    if (mgs.length > 0) {
      const init: Record<string, string[]> = {};
      mgs.forEach(g => { init[g._id] = []; });
      setModSelections(init);
      setModifierPicker({ product, effectivePrice, variantId, variantName });
    } else {
      addItem(product, effectivePrice, variantId, variantName);
    }
  };

  const buildSelectedModifiers = (product: Product): SelectedModifier[] => {
    const groups = (product.modifierGroups || []).filter(g => g.isActive);
    const result: SelectedModifier[] = [];
    groups.forEach(group => {
      const chosen = modSelections[group._id] || [];
      chosen.forEach(optId => {
        const opt = group.options.find(o => o._id === optId);
        if (opt) {
          result.push({
            modifierGroupId:    group._id,
            modifierGroupName:  group.name,
            modifierOptionId:   opt._id,
            modifierOptionName: opt.name,
            modifierPrice:      opt.price,
            modifierTotal:      opt.price,
          });
        }
      });
    });
    return result;
  };

  const validateModifiers = (product: Product): string | null => {
    const groups = (product.modifierGroups || []).filter(g => g.isActive);
    for (const group of groups) {
      const chosen = (modSelections[group._id] || []).length;
      if (group.isRequired && chosen < (group.minSelections || 1)) {
        return `"${group.name}" requires at least ${group.minSelections || 1} selection(s).`;
      }
      if (group.selectionType === 'multi' && group.maxSelections > 0 && chosen > group.maxSelections) {
        return `"${group.name}" allows at most ${group.maxSelections} selection(s).`;
      }
    }
    return null;
  };

  const confirmModifiers = () => {
    if (!modifierPicker) return;
    const err = validateModifiers(modifierPicker.product);
    if (err) { showAlert('Selection Required', err); return; }
    const selectedModifiers = buildSelectedModifiers(modifierPicker.product);
    addItem(modifierPicker.product, modifierPicker.effectivePrice, modifierPicker.variantId, modifierPicker.variantName, selectedModifiers);
    setModifierPicker(null);
  };

  const handleSourceChange = (src: OrderSource) => {
    setOrderSource(src);
    setParcel(['swiggy', 'zomato', 'takeaway'].includes(src));
  };

  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${n.toFixed(2)}`;
  const isMaterialIcon = (name?: string) => !!name && /^[a-z0-9-_]+$/.test(name);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, prods, tbls] = await Promise.all([api.getCategories(), api.getProducts(), api.getTables()]);
      setCategories(cats);
      setProducts(prods);
      setFiltered(prods);
      setSelectedCat(null);
      setTables(tbls.filter(t => t.status !== 'inactive'));
      saveCategories(cats);
      saveProducts(prods);
    } catch {
      // Offline: load from SQLite cache
      const cachedCats  = getLocalCategories();
      const cachedProds = getLocalProducts();
      if (cachedProds.length > 0) {
        setCategories(cachedCats);
        setProducts(cachedProds);
        setFiltered(cachedProds);
        setSelectedCat(null);
      } else {
        showAlert('Offline', 'No cached menu data. Connect to the internet to load products.');
      }
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
  }, [search, products, handleCategorySelect, selectedCat]);

  useEffect(() => {
    if (IS_TABLET) setShowCart(!isPortrait);
  }, [isPortrait, IS_TABLET]);

  const applyDiscount = () => {
    const val = parseFloat(discountInput) || 0;
    setDiscount({ type: discountType, value: val });
  };

  const handleApplyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) return;
    const preTax = cart.subtotal + cart.taxTotal;
    setCouponLoading(true);
    try {
      const result = await api.validateCoupon(code, preTax, undefined);
      if (result.valid && result.couponId) {
        setAppliedCoupon({ couponId: String(result.couponId), code: result.code ?? code, discountAmount: result.discountAmount ?? 0, description: result.description ?? '' });
      } else {
        showAlert('Invalid Coupon', result.message ?? 'Coupon could not be applied');
      }
    } catch (e: any) { showAlert('Coupon Error', e?.message ?? 'Could not validate coupon'); }
    finally { setCouponLoading(false); }
  };

  const handleCheckVoucher = async () => {
    const code = voucherCode.trim().toUpperCase();
    if (!code) return;
    setVoucherLoading(true);
    try {
      const result = await api.checkGiftVoucher(code);
      if (result.valid && result.voucher) {
        const maxRedeem = Math.min(result.voucher.balance, cart.subtotal + cart.taxTotal);
        setAppliedVoucher({ voucherCode: code, balance: result.voucher.balance, redeemAmount: maxRedeem });
      } else {
        showAlert('Invalid Voucher', result.message ?? 'Voucher not found or inactive');
      }
    } catch (e: any) { showAlert('Voucher Error', e?.message ?? 'Could not check voucher'); }
    finally { setVoucherLoading(false); }
  };

  const handleLoadWallet = async () => {
    const phone = customerPhone.replace(/\D/g, '').replace(/^0+/, '');
    if (phone.length < 10) { showAlert('Phone Required', 'Enter a valid 10-digit phone number first'); return; }
    try {
      const results = await api.getLoyaltyCustomers({ phone });
      const customer = results.customers?.[0];
      if (customer && customer.walletBalance !== undefined) {
        setWalletInfo({ customerId: customer.customerId, walletBalance: customer.walletBalance });
        setUseWallet(true);
      } else {
        showAlert('Not Found', 'No wallet found for this phone number');
      }
    } catch (e: any) { showAlert('Wallet Error', e?.message ?? 'Could not load wallet'); }
  };

  const getChannelPrice = (product: Product): number => {
    const cp = product.channelPrices;
    if (!cp) return product.price;
    const key = orderSource === 'swiggy' ? 'swiggy'
              : orderSource === 'zomato'  ? 'zomato'
              : orderSource === 'qr'      ? 'qr'
              : null;
    if (!key) return product.price;
    const p = cp[key];
    return p && p > 0 ? p : product.price;
  };

  const buildUpiUrl = (amount: number) => {
    const upiId  = settings.upiId || UPI_ID;
    const name   = encodeURIComponent(settings.hotelName || UPI_NAME);
    const am     = amount.toFixed(2);
    return `upi://pay?pa=${upiId}&pn=${name}&am=${am}&cu=INR`;
  };

  const sendWhatsApp = (order: OrderSuccess) => {
    if (!customerPhone.trim()) { showAlert('Phone Missing', 'Enter customer phone number first.'); return; }
    // Normalize phone: strip non-digits, remove leading 0, ensure 10 digits
    const digits = customerPhone.replace(/\D/g, '').replace(/^0+/, '');
    const phone = digits.startsWith('91') && digits.length === 12 ? digits : `91${digits}`;

    // Use items from order snapshot (cart is already cleared at this point)
    const itemLines = order.items.map(i => `  ${i.name} x${i.qty} — ${cur}${(i.price * i.qty).toFixed(0)}`).join('\n');
    const msg =
`*${settings.hotelName || 'Restaurant'} — Digital Bill*
Order: ${order.orderNumber}
Token: #${order.token}
---
${itemLines}
---
Subtotal: ${cur}${order.subtotal.toFixed(2)}
Tax: ${cur}${order.taxTotal.toFixed(2)}
${order.discountAmount > 0 ? `Discount: -${cur}${order.discountAmount.toFixed(2)}\n` : ''}*Total: ${cur}${order.grandTotal.toFixed(2)}*
---
Thank you for dining with us! 🍽️`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    Linking.openURL(url).catch(() => showAlert('Error', 'Could not open WhatsApp'));
  };

  const handlePrintKOT = async (order: OrderSuccess) => {
    setPrintingKot(true);
    try {
      await printKOT(order.kot, settings);
    } catch (e: any) {
      showAlert('Print Error', e.message || 'Failed to print KOT');
    } finally {
      setPrintingKot(false);
    }
  };

  const handlePlaceOrder = () => {
    if (cart.items.length === 0) { showAlert('Empty Cart', 'Add items first.'); return; }
    if (!cart.customerName.trim()) { showAlert('Name Required', 'Enter customer name before placing the order.'); return; }
    if (!customerPhone.trim()) { showAlert('Phone Required', 'Enter customer phone number before placing the order.'); return; }
    // Compute all deductions inline so we don't rely on async state updates
    const discountVal       = parseFloat(discountInput) || 0;
    const preTax            = cart.subtotal + cart.taxTotal;
    const manualDiscount    = discountVal > 0
      ? (discountType === 'percent' ? (preTax * discountVal) / 100 : Math.min(discountVal, preTax))
      : 0;
    const voucherRedeem     = appliedVoucher?.redeemAmount  ?? 0;
    const walletDeduct      = useWallet && walletInfo ? Math.min(walletInfo.walletBalance, Math.max(0, preTax - manualDiscount - voucherRedeem)) : 0;
    // coupon discount intentionally excluded — server applies from couponCode
    // voucherRedeem excluded from payload — server applies from giftVoucherCode
    const payloadDiscountAmount = manualDiscount + walletDeduct;
    const discountAmount    = manualDiscount + voucherRedeem + walletDeduct;
    const finalGrandTotal   = Math.max(0, preTax - discountAmount - (appliedCoupon?.discountAmount ?? 0));
    applyDiscount();

    const isOrderParcel = ['swiggy', 'zomato', 'takeaway'].includes(orderSource);
    const getTableNumber = () => {
      if (orderSource === 'swiggy')   return 'Swiggy';
      if (orderSource === 'zomato')   return 'Zomato';
      if (orderSource === 'takeaway') return 'Takeaway';
      return cart.tableNumber;
    };
    // offlineId: idempotency key so a network retry on createOrder never duplicates the order
    const offlineId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const orderData = {
      items: cart.items.map(item => ({
        product:           item.product._id,
        productName:       item.product.name,
        variantId:         item.variantId   || '',
        variantName:       item.variantName || '',
        selectedModifiers: (item.selectedModifiers || []).map(m => ({ ...m, modifierTotal: m.modifierPrice * item.quantity })),
        quantity:          item.quantity,
        price:             item.effectivePrice + item.modifierTotal,
        taxPercent:        item.product.taxPercent,
        taxAmount:         item.taxAmount,
        total:             item.total,
      })),
      subtotal:      cart.subtotal,
      taxTotal:      cart.taxTotal,
      grandTotal:    finalGrandTotal,
      discountAmount: payloadDiscountAmount,
      couponCode:    appliedCoupon?.code || undefined,
      giftVoucherCode: appliedVoucher?.voucherCode || undefined,
      status:        'pending',
      tableNumber:   getTableNumber(),
      customerName:  cart.customerName,
      customerPhone: customerPhone.replace(/\D/g, '').replace(/^0+/, '').slice(0, 12) || undefined,
      notes:         cart.notes,
      isParcel:      isOrderParcel,
      orderSource,
      offlineId,
    };
    setPendingOrder(orderData as Record<string, unknown>);
    const promos: { walletCustomerId?: string; walletAmount?: number } = {};
    // giftVoucherCode now sent directly in orderData — server-authoritative; removed from promos
    if (walletDeduct > 0 && walletInfo) { promos.walletCustomerId = walletInfo.customerId; promos.walletAmount = walletDeduct; }
    navigation.navigate('PaymentScreen', { mode: 'billing', grandTotal: finalGrandTotal, promos: Object.keys(promos).length ? promos : undefined });
  };

  const handleRazorpayFlow = () => {
    if (cart.items.length === 0) { showAlert('Empty Cart', 'Add items first.'); return; }
    if (!cart.customerName.trim()) { showAlert('Name Required', 'Enter customer name before placing the order.'); return; }
    if (!customerPhone.trim()) { showAlert('Phone Required', 'Enter customer phone number before placing the order.'); return; }
    if (placing) return; // P0-4: guard against double-tap
    setPlacing(true);    // P0-4: disable both buttons while Razorpay flow is in flight
    applyDiscount();
    handleRazorpayCheckout();
  };

  const handleRazorpayCheckout = async () => {
    const isOrderParcel = ['swiggy', 'zomato', 'takeaway'].includes(orderSource);
    const getTableNumber = () => {
      if (orderSource === 'swiggy')   return 'Swiggy';
      if (orderSource === 'zomato')   return 'Zomato';
      if (orderSource === 'takeaway') return 'Takeaway';
      return cart.tableNumber;
    };
    const orderData = {
      items: cart.items.map(item => ({
        product:           item.product._id,
        productName:       item.product.name,
        variantId:         item.variantId   || '',
        variantName:       item.variantName || '',
        selectedModifiers: (item.selectedModifiers || []).map(m => ({ ...m, modifierTotal: m.modifierPrice * item.quantity })),
        quantity:          item.quantity,
        price:             item.effectivePrice + item.modifierTotal,
        taxPercent:        item.product.taxPercent,
        taxAmount:         item.taxAmount,
        total:             item.total,
      })),
      subtotal:      cart.subtotal,
      taxTotal:      cart.taxTotal,
      grandTotal:    cart.grandTotal,
      discountAmount:cart.discountAmount,
      couponCode:    appliedCoupon?.code || undefined,
      paymentMethod: 'razorpay' as const,
      status:        'pending' as const,
      tableNumber:   getTableNumber(),
      customerName:  cart.customerName,
      customerPhone: customerPhone.replace(/\D/g, '').replace(/^0+/, '').slice(0, 12) || undefined,
      notes:         cart.notes,
      isParcel:      isOrderParcel,
      orderSource,
    };

    const cartSnapshot = {
      items:          cart.items.map(i => ({ name: i.variantName ? `${i.product.name} (${i.variantName})` : i.product.name, qty: i.quantity, price: i.effectivePrice })),
      subtotal:       cart.subtotal,
      taxTotal:       cart.taxTotal,
      discountAmount: cart.discountAmount,
      grandTotal:     cart.grandTotal,
    };
    const kotSnapshot: Omit<KOTOrderInput, 'orderNumber'> = {
      items:       cart.items.map(i => ({ productName: i.variantName ? `${i.product.name} (${i.variantName})` : i.product.name, quantity: i.quantity })),
      tableNumber: getTableNumber(),
      notes:       cart.notes,
      createdAt:   new Date().toISOString(),
    };

    try {
      // 1. Create the order
      const order = await api.createOrder(orderData);

      // 2. Create Razorpay order on backend — use server's grandTotal (includes coupon discount)
      const intent = await api.createPaymentIntent(order._id, order.grandTotal, {
        currency:     'INR',
        customerName: cart.customerName || undefined,
        description:  `Order ${order.orderNumber}`,
      });

      if (!intent.gatewayIntegrated || intent.gatewayError) {
        showAlert('Payment Error', intent.gatewayError ?? 'Gateway not integrated. Use another payment method.');
        setPlacing(false);
        return;
      }

      const keyId         = intent.gatewayData?.metadata?.keyId;
      const razorpayOrder = intent.gatewayData?.metadata?.orderId ?? intent.gatewayData?.gatewayOrderId;
      const amountPaise   = intent.gatewayData?.metadata?.amount ?? Math.round(order.grandTotal * 100);

      if (!keyId || !razorpayOrder) {
        showAlert('Payment Error', 'Gateway returned invalid checkout parameters.');
        setPlacing(false);
        return;
      }

      // 3. Open Razorpay native checkout
      const response = await RazorpayCheckout.open({
        key:         keyId,
        amount:      String(amountPaise),
        currency:    'INR',
        name:        settings.hotelName || 'Restaurant',
        description: `Order ${order.orderNumber}`,
        order_id:    razorpayOrder,
        prefill: {
          name:    cart.customerName || undefined,
          contact: customerPhone.replace(/\D/g, '').slice(0, 10) || undefined,
        },
        theme: { color: Colors.info },
      });

      // 4. Verify signature on backend
      await api.verifyPaymentIntent(
        intent.payment.internalTransactionId,
        response.razorpay_payment_id,
        response.razorpay_signature,
      );

      // 5. Success
      const tokenNum = order.orderNumber.split('-').pop() || '1';
      setShowSuccess({ orderNumber: order.orderNumber, token: tokenNum, ...cartSnapshot, discountAmount: (order.discountAmount || 0) + (order.couponDiscount || 0), grandTotal: order.grandTotal, kot: { orderNumber: order.orderNumber, ...kotSnapshot } });
      Vibration.vibrate([0, 100, 80, 200]);
      clearCart();
      setDiscountInput('');
      setDiscount({ type: 'percent', value: 0 });
      // Reset promos
      setCouponCode(''); setAppliedCoupon(null);
      setVoucherCode(''); setAppliedVoucher(null);
      setWalletInfo(null); setUseWallet(false);
    } catch (e: any) {
      const desc: string = e?.description ?? e?.message ?? 'Payment failed or cancelled.';
      if (e?.code !== 'USER_CANCEL') {
        showAlert('Payment Failed', desc);
      }
    } finally {
      setPlacing(false);
    }
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

  // ── Horizontal category chip (phones only) ───────────────────────────────
  const renderCatChip = (cat: Category | null) => {
    const active = cat ? selectedCat === cat._id : selectedCat === null;
    const iconName = cat?.icon;
    return (
      <TouchableOpacity
        key={cat?._id || 'all'}
        style={[styles.catChip, active && styles.catChipActive]}
        onPress={() => handleCategorySelect(cat?._id || null)}
        activeOpacity={0.75}
      >
        {isMaterialIcon(iconName)
          ? <MaterialIcons name={iconName as any} size={15} color={active ? Colors.white : Colors.textSecondary} />
          : iconName
            ? <Text style={{ fontSize: 13 }}>{iconName}</Text>
            : <MaterialIcons name="apps" size={15} color={active ? Colors.white : Colors.textSecondary} />
        }
        <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
          {cat?.name || 'All'}
        </Text>
      </TouchableOpacity>
    );
  };

  // ── Product tile — card style with image ──────────────────────────────────
  const renderProduct = ({ item }: { item: Product }) => {
    const qty = cart.items.filter(i => i.product._id === item._id).reduce((sum, i) => sum + i.quantity, 0);
    const accentColor = item.isVeg ? Colors.veg : Colors.nonVeg;
    const hasVariants = (item.variants?.length ?? 0) > 0;
    const openOrAdd = () => hasVariants ? setVariantPickerProduct(item) : openModifiersOrAdd(item, getChannelPrice(item));
    return (
      <TouchableOpacity
        style={[styles.prodTile, qty > 0 && styles.prodTileActive]}
        onPress={openOrAdd}
        activeOpacity={0.75}
      >
        {/* Image / placeholder */}
        <View style={styles.prodTileImgWrap}>
          {item.image
            ? <Image source={{ uri: applyCloudinaryTransform(item.image, 100, 100) ?? item.image }} style={styles.prodTileImg} resizeMode="cover" />
            : <View style={[styles.prodTileImgPlaceholder, { backgroundColor: accentColor + '18' }]}>
                <MaterialIcons name="restaurant" size={22} color={accentColor} />
              </View>
          }
          {/* Non-veg warning only */}
          {!item.isVeg && (
            <View style={[styles.vegPill, { borderColor: Colors.nonVeg }]}>
              <View style={[styles.vegDot, { backgroundColor: Colors.nonVeg }]} />
            </View>
          )}
          {/* Qty badge — pinned top-right */}
          {qty > 0 && (
            <View style={styles.qtyBadge}>
              <Text style={styles.qtyBadgeText}>{qty}</Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.prodTileInner}>
          <Text style={styles.prodTileName} numberOfLines={2}>{item.name}</Text>
          <View style={styles.prodTilePriceRow}>
            <Text style={styles.prodTilePrice}>{cur}{getChannelPrice(item).toFixed(0)}</Text>
            {item.taxPercent > 0 && <Text style={styles.prodTileTax}> +{item.taxPercent}%</Text>}
          </View>
          {qty > 0 && !hasVariants ? (
            <View style={styles.prodTileQtyRow}>
              <TouchableOpacity style={styles.prodTileQtyBtn} onPress={() => decrement(`${item._id}:base`)} hitSlop={{ top: 6, bottom: 6, left: 8, right: 4 }}>
                <MaterialIcons name="remove" size={13} color={Colors.white} />
              </TouchableOpacity>
              <Text style={styles.prodTileQtyNum}>{qty}</Text>
              <TouchableOpacity style={styles.prodTileQtyBtn} onPress={() => openModifiersOrAdd(item, getChannelPrice(item))} hitSlop={{ top: 6, bottom: 6, left: 4, right: 8 }}>
                <MaterialIcons name="add" size={13} color={Colors.white} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.prodTileAddRow} onPress={openOrAdd} activeOpacity={0.7}>
              <MaterialIcons name={hasVariants ? 'expand-more' : 'add'} size={14} color={Colors.white} />
              <Text style={styles.prodTileAddText}>{hasVariants ? 'CHOOSE' : 'ADD'}</Text>
            </TouchableOpacity>
          )}
        </View>
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
          {!!item.variantName && (
            <Text style={styles.cartItemVariant} numberOfLines={1}>{item.variantName}</Text>
          )}
          {(item.selectedModifiers || []).map((m, idx) => (
            <Text key={idx} style={styles.cartItemVariant} numberOfLines={1}>+{m.modifierOptionName}{m.modifierPrice > 0 ? ` (${cur}${m.modifierPrice})` : ''}</Text>
          ))}
          <Text style={styles.cartItemUnitPrice}>{cur}{(item.effectivePrice + item.modifierTotal).toFixed(0)} each</Text>
        </View>
      </View>
      <View style={styles.cartItemRight}>
        <Text style={styles.cartItemTotal}>{cur}{((item.effectivePrice + item.modifierTotal) * item.quantity).toFixed(0)}</Text>
        <View style={styles.qtyRow}>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => decrement(item.cartLineId)}>
            <MaterialIcons name="remove" size={15} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.qtyNum}>{item.quantity}</Text>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => increment(item.cartLineId)}>
            <MaterialIcons name="add" size={15} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.removeBtn} onPress={() => removeItem(item.cartLineId)}>
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
      {/* ── Header / Search — hidden when cart is open on mobile ── */}
      {(!showCart || (IS_TABLET && !tabletPortrait)) && (
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
          {(!IS_TABLET || tabletPortrait) && (
            <TouchableOpacity style={[styles.cartToggle, itemCount > 0 && styles.cartToggleActive]} onPress={() => setShowCart(!showCart)}>
              <MaterialIcons name="shopping-cart" size={22} color={itemCount > 0 ? Colors.white : Colors.textSecondary} />
              {itemCount > 0 && <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{itemCount}</Text></View>}
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={styles.body}>
        {/* ── Categories — vertical list (tablet landscape only) ── */}
        {IS_TABLET && !tabletPortrait && (
          <ScrollView style={styles.catList} showsVerticalScrollIndicator={false}>
            {renderCat(null)}
            {categories.map(c => renderCat(c))}
          </ScrollView>
        )}

        {/* ── Center column: chips (phone/portrait tablet) + product grid ── */}
        {((IS_TABLET && !tabletPortrait) || !showCart) && (
          <View style={{ flex: 1, flexDirection: 'column' }}>
            {/* Category chips — phone and portrait tablet */}
            {(!IS_TABLET || tabletPortrait) && (
              <View style={styles.catChipWrap}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.catChipContent}
                >
                  {renderCatChip(null)}
                  {categories.map(c => renderCatChip(c))}
                </ScrollView>
              </View>
            )}
            <FlatList
              data={filtered}
              renderItem={renderProduct}
              keyExtractor={i => i._id}
              numColumns={COLS}
              key={COLS}
              style={{ flex: 1 }}
              contentContainerStyle={styles.prodGrid}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <MaterialIcons name="restaurant" size={48} color={Colors.textMuted} />
                  <Text style={styles.emptyText}>No items found</Text>
                </View>
              }
            />
          </View>
        )}

        {/* ── Cart Panel ── */}
        {((IS_TABLET && !tabletPortrait) || showCart) && (
          <View style={[styles.cartPanel, (!IS_TABLET || tabletPortrait) && { width: '100%' }]}>
            {/* Cart header */}
            <View style={styles.cartHeader}>
              <Text style={styles.cartTitle}>Current Order</Text>
              {(!IS_TABLET || tabletPortrait) && (
                <TouchableOpacity onPress={() => setShowCart(false)} style={{ padding: 4 }}>
                  <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Order source selector */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sourceScroll} contentContainerStyle={styles.sourceScrollContent}>
              {SOURCE_OPTIONS.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.sourceBtn, orderSource === s.id && { backgroundColor: s.color + '22', borderColor: s.color }]}
                  onPress={() => handleSourceChange(s.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.sourceEmoji}>{s.emoji}</Text>
                  <Text style={[styles.sourceLabel, orderSource === s.id && { color: s.color, fontWeight: '700' }]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

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
              {!cart.isParcel && orderSource === 'dine-in' && (
                <TouchableOpacity
                  style={[styles.custInput, { width: 110 }]}
                  onPress={() => { setTableSearch(''); setShowTablePicker(true); }}
                  activeOpacity={0.75}
                >
                  <MaterialIcons name="grid-on" size={16} color={Colors.textMuted} />
                  <Text style={[styles.custInputText, { flex: 1, paddingVertical: 0, color: cart.tableNumber ? Colors.text : Colors.textMuted }]}>
                    {cart.tableNumber || 'Table'}
                  </Text>
                  <MaterialIcons name="arrow-drop-down" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
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
              keyExtractor={i => i.cartLineId}
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

            {/* Coupon */}
            {cart.items.length > 0 && (
              <View style={styles.promoRow}>
                {appliedCoupon ? (
                  <View style={styles.promoApplied}>
                    <MaterialIcons name="local-offer" size={14} color={Colors.success} />
                    <Text style={styles.promoAppliedText}>{appliedCoupon.code} −{fmt(appliedCoupon.discountAmount)}</Text>
                    <TouchableOpacity onPress={() => { setAppliedCoupon(null); setCouponCode(''); }}>
                      <MaterialIcons name="close" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.promoInputRow}>
                    <TextInput
                      style={styles.promoInput}
                      placeholder="Coupon code"
                      placeholderTextColor={Colors.textMuted}
                      value={couponCode}
                      onChangeText={v => setCouponCode(v.toUpperCase())}
                      autoCapitalize="characters"
                    />
                    <TouchableOpacity style={styles.promoBtn} onPress={handleApplyCoupon} disabled={couponLoading || !couponCode.trim()}>
                      {couponLoading ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.promoBtnText}>Apply</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* Gift Voucher */}
            {cart.items.length > 0 && (
              <View style={styles.promoRow}>
                {appliedVoucher ? (
                  <View style={styles.promoApplied}>
                    <MaterialIcons name="card-giftcard" size={14} color={Colors.success} />
                    <Text style={styles.promoAppliedText}>{appliedVoucher.voucherCode} −{fmt(appliedVoucher.redeemAmount)}</Text>
                    <TouchableOpacity onPress={() => { setAppliedVoucher(null); setVoucherCode(''); }}>
                      <MaterialIcons name="close" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.promoInputRow}>
                    <TextInput
                      style={styles.promoInput}
                      placeholder="Gift voucher code"
                      placeholderTextColor={Colors.textMuted}
                      value={voucherCode}
                      onChangeText={v => setVoucherCode(v.toUpperCase())}
                      autoCapitalize="characters"
                    />
                    <TouchableOpacity style={styles.promoBtn} onPress={handleCheckVoucher} disabled={voucherLoading || !voucherCode.trim()}>
                      {voucherLoading ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.promoBtnText}>Check</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* Wallet */}
            {cart.items.length > 0 && (
              <View style={styles.promoRow}>
                {walletInfo ? (
                  <View style={styles.promoApplied}>
                    <MaterialIcons name="account-balance-wallet" size={14} color={useWallet ? Colors.success : Colors.textMuted} />
                    <Text style={styles.promoAppliedText}>
                      Wallet {fmt(walletInfo.walletBalance)} {useWallet ? '(will deduct)' : '(tap to use)'}
                    </Text>
                    <TouchableOpacity onPress={() => setUseWallet(v => !v)}>
                      <MaterialIcons name={useWallet ? 'toggle-on' : 'toggle-off'} size={22} color={useWallet ? Colors.success : Colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setWalletInfo(null); setUseWallet(false); }} style={{ marginLeft: 4 }}>
                      <MaterialIcons name="close" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.promoInputRow} onPress={handleLoadWallet}>
                    <MaterialIcons name="account-balance-wallet" size={16} color={Colors.textMuted} />
                    <Text style={[styles.promoInput, { color: Colors.textMuted, lineHeight: 34 }]}>Load customer wallet</Text>
                  </TouchableOpacity>
                )}
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
                  <Text style={[styles.totalLabel, { color: Colors.success }]}>Manual Discount</Text>
                  <Text style={[styles.totalVal, { color: Colors.success }]}>−{fmt(cart.discountAmount)}</Text>
                </View>
              )}
              {appliedCoupon && (
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: Colors.success }]}>Coupon ({appliedCoupon.code})</Text>
                  <Text style={[styles.totalVal, { color: Colors.success }]}>−{fmt(appliedCoupon.discountAmount)}</Text>
                </View>
              )}
              {appliedVoucher && appliedVoucher.redeemAmount > 0 && (
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: Colors.success }]}>Gift Voucher</Text>
                  <Text style={[styles.totalVal, { color: Colors.success }]}>−{fmt(appliedVoucher.redeemAmount)}</Text>
                </View>
              )}
              {useWallet && walletInfo && (() => {
                const preTax = cart.subtotal + cart.taxTotal;
                const couponDiscount = appliedCoupon?.discountAmount ?? 0;
                const voucherRedeem = appliedVoucher?.redeemAmount ?? 0;
                const walletDeduct = Math.min(walletInfo.walletBalance, Math.max(0, preTax - cart.discountAmount - couponDiscount - voucherRedeem));
                return walletDeduct > 0 ? (
                  <View style={styles.totalRow}>
                    <Text style={[styles.totalLabel, { color: Colors.success }]}>Wallet</Text>
                    <Text style={[styles.totalVal, { color: Colors.success }]}>−{fmt(walletDeduct)}</Text>
                  </View>
                ) : null;
              })()}
              <View style={[styles.totalRow, styles.grandRow]}>
                <Text style={styles.grandLabel}>TOTAL</Text>
                <Text style={styles.grandVal}>{(() => {
                  const preTax = cart.subtotal + cart.taxTotal;
                  const couponDiscount = appliedCoupon?.discountAmount ?? 0;
                  const voucherRedeem = appliedVoucher?.redeemAmount ?? 0;
                  const walletDeduct = useWallet && walletInfo ? Math.min(walletInfo.walletBalance, Math.max(0, preTax - cart.discountAmount - couponDiscount - voucherRedeem)) : 0;
                  return fmt(Math.max(0, preTax - cart.discountAmount - couponDiscount - voucherRedeem - walletDeduct));
                })()}</Text>
              </View>
            </View>

            {/* Actions */}
            <View style={[styles.cartActions, { paddingBottom: (bottom || 0) + Spacing.sm }]}>
              <TouchableOpacity style={styles.clearBtn} onPress={() => { if (cart.items.length) showAlert('Clear?', 'Remove all items?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: clearCart }]); }}>
                <MaterialIcons name="delete-outline" size={20} color={Colors.danger} />
              </TouchableOpacity>
              {!!settings?.razorpayKeyId && (
                <TouchableOpacity
                  style={[styles.razorpayBtn, (cart.items.length === 0 || placing || !cart.customerName.trim() || !customerPhone.trim()) && styles.placeBtnDisabled]}
                  onPress={handleRazorpayFlow}
                  disabled={placing || cart.items.length === 0 || !cart.customerName.trim() || !customerPhone.trim()}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="currency-rupee" size={18} color={Colors.info} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.placeBtn, (cart.items.length === 0 || placing || !cart.customerName.trim() || !customerPhone.trim()) && styles.placeBtnDisabled]}
                onPress={handlePlaceOrder}
                disabled={placing || cart.items.length === 0 || !cart.customerName.trim() || !customerPhone.trim()}
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

      {/* ── Table Picker Modal ── */}
      <Modal visible={showTablePicker} transparent animationType="slide" onRequestClose={() => setShowTablePicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.payModal, { paddingBottom: 24 + bottom, maxHeight: '80%' }]}>
            <View style={styles.payModalHandle} />
            <Text style={styles.payModalTitle}>Select Table</Text>

            {/* Search */}
            <View style={[styles.custInput, { marginHorizontal: 0, marginBottom: 12 }]}>
              <MaterialIcons name="search" size={16} color={Colors.textMuted} />
              <TextInput
                style={[styles.custInputText, { flex: 1 }]}
                placeholder="Search table..."
                placeholderTextColor={Colors.textMuted}
                value={tableSearch}
                onChangeText={setTableSearch}
                autoFocus
              />
              {tableSearch.length > 0 && (
                <TouchableOpacity onPress={() => setTableSearch('')}>
                  <MaterialIcons name="close" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {tables
                  .filter(t => {
                    if (!tableSearch.trim()) return true;
                    const q = tableSearch.toLowerCase();
                    return (t.name || `T${t.number}`).toLowerCase().includes(q);
                  })
                  .map(t => {
                    const label = t.name || `T${t.number}`;
                    const isOccupied = t.status === 'occupied';
                    const isSelected = cart.tableNumber === label;
                    return (
                      <TouchableOpacity
                        key={t._id}
                        style={[
                          styles.tablePickerCard,
                          isOccupied && styles.tablePickerCardOccupied,
                          isSelected && styles.tablePickerCardSelected,
                        ]}
                        onPress={() => {
                          setTable(label);
                          setShowTablePicker(false);
                          setTableSearch('');
                        }}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.tablePickerName, isSelected && { color: Colors.white }]}>{label}</Text>
                        <View style={[
                          styles.tablePickerStatus,
                          { backgroundColor: isOccupied ? Colors.danger + '22' : Colors.success + '22' },
                        ]}>
                          <Text style={[styles.tablePickerStatusText, { color: isOccupied ? Colors.danger : Colors.success }]}>
                            {isOccupied ? 'Busy' : 'Free'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
              </View>
              {tables.filter(t => {
                if (!tableSearch.trim()) return true;
                const q = tableSearch.toLowerCase();
                return (t.name || `T${t.number}`).toLowerCase().includes(q);
              }).length === 0 && (
                <Text style={{ textAlign: 'center', color: Colors.textMuted, paddingVertical: 24, fontSize: FontSize.sm }}>
                  No tables found
                </Text>
              )}
            </ScrollView>

            <TouchableOpacity style={[styles.payCancel, { marginTop: 12, marginHorizontal: 0 }]} onPress={() => setShowTablePicker(false)}>
              <Text style={styles.payCancelText}>Cancel</Text>
            </TouchableOpacity>
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

      {/* ── Variant Picker Modal ── */}
      <Modal visible={!!variantPickerProduct} transparent animationType="slide" onRequestClose={() => setVariantPickerProduct(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.payModal, { paddingBottom: 24 + bottom }]}>
            <View style={styles.payModalHandle} />
            <Text style={styles.payModalTitle}>{variantPickerProduct?.name}</Text>
            <Text style={[styles.payModalAmount, { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xl }]}>
              Choose a variant to add
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {variantPickerProduct?.variants?.map(variant => (
                <TouchableOpacity
                  key={variant._id}
                  style={styles.variantRow}
                  onPress={() => {
                    setVariantPickerProduct(null);
                    openModifiersOrAdd(variantPickerProduct, variant.price, variant._id, variant.name);
                  }}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.variantName}>{variant.name}</Text>
                  </View>
                  <Text style={styles.variantPrice}>{cur}{variant.price.toFixed(0)}</Text>
                  <View style={styles.variantAddBtn}>
                    <MaterialIcons name="add" size={16} color={Colors.white} />
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={[styles.payCancel, { marginTop: Spacing.lg }]} onPress={() => setVariantPickerProduct(null)}>
              <Text style={styles.payCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Modifier Picker Modal ── */}
      <Modal visible={!!modifierPicker} transparent animationType="slide" onRequestClose={() => setModifierPicker(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.payModal, { paddingBottom: 24 + bottom, maxHeight: '85%' }]}>
            <View style={styles.payModalHandle} />
            <Text style={styles.payModalTitle}>{modifierPicker?.product.name}</Text>
            {modifierPicker && (() => {
              const mgs: ModifierGroup[] = (modifierPicker.product.modifierGroups || []).filter((g: ModifierGroup) => g.isActive);
              const modTotal = mgs.reduce((s, group) => {
                const chosen = modSelections[group._id] || [];
                return s + chosen.reduce((gs, optId) => {
                  const opt = group.options.find(o => o._id === optId);
                  return gs + (opt?.price || 0);
                }, 0);
              }, 0);
              return (
                <>
                  <Text style={[styles.payModalAmount, { fontSize: FontSize.sm, marginBottom: Spacing.md }]}>
                    {cur}{(modifierPicker.effectivePrice + modTotal).toFixed(0)}
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
                    {mgs.map(group => (
                      <View key={group._id} style={{ marginBottom: Spacing.lg }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm }}>
                          <Text style={{ fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, flex: 1 }}>{group.name}</Text>
                          {group.isRequired && (
                            <View style={{ backgroundColor: Colors.danger + '18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, color: Colors.danger, fontWeight: '600' }}>REQUIRED</Text>
                            </View>
                          )}
                          {!group.isRequired && (
                            <View style={{ backgroundColor: Colors.textMuted + '18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600' }}>OPTIONAL</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontSize: 11, color: Colors.textMuted, marginBottom: Spacing.sm }}>
                          {group.selectionType === 'single' ? 'Choose one' : `Choose up to ${group.maxSelections}`}
                        </Text>
                        {group.options.filter(o => o.isActive).map(opt => {
                          const chosen = (modSelections[group._id] || []).includes(opt._id);
                          return (
                            <TouchableOpacity
                              key={opt._id}
                              style={[styles.variantRow, chosen && { borderColor: Colors.primary, backgroundColor: Colors.primary + '10' }]}
                              onPress={() => {
                                setModSelections(prev => {
                                  const cur2 = prev[group._id] || [];
                                  if (group.selectionType === 'single') {
                                    return { ...prev, [group._id]: chosen ? [] : [opt._id] };
                                  }
                                  if (chosen) {
                                    return { ...prev, [group._id]: cur2.filter(id => id !== opt._id) };
                                  }
                                  if (group.maxSelections > 0 && cur2.length >= group.maxSelections) return prev;
                                  return { ...prev, [group._id]: [...cur2, opt._id] };
                                });
                              }}
                              activeOpacity={0.75}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.variantName, chosen && { color: Colors.primary }]}>{opt.name}</Text>
                              </View>
                              {opt.price > 0 && <Text style={[styles.variantPrice, chosen && { color: Colors.primary }]}>+{cur}{opt.price}</Text>}
                              <View style={[styles.variantAddBtn, chosen && { backgroundColor: Colors.primary }]}>
                                <MaterialIcons name={chosen ? 'check' : 'add'} size={16} color={Colors.white} />
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </ScrollView>
                  <TouchableOpacity
                    style={[styles.payConfirm, { marginTop: Spacing.md }]}
                    onPress={confirmModifiers}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="add-shopping-cart" size={18} color={Colors.white} />
                    <Text style={styles.payConfirmText}>Add to Cart — {cur}{(modifierPicker.effectivePrice + modTotal).toFixed(0)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.payCancel, { marginTop: Spacing.sm }]} onPress={() => setModifierPicker(null)}>
                    <Text style={styles.payCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
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
                onPress={() => {
                  if (!(settings.upiId || UPI_ID)) {
                    showAlert('UPI Not Configured', 'Configure your UPI ID in Settings to accept UPI payments.');
                    return;
                  }
                  setShowUpiQr(true);
                }}
              >
                <MaterialIcons name="qr-code" size={18} color={Colors.upi} />
                <Text style={[styles.successPrintText, { color: Colors.upi }]}>UPI QR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.successPrintBtn, { flex: 1 }]}
                onPress={() => { if (showSuccess) handlePrintKOT(showSuccess); }}
                disabled={printingKot}
              >
                {printingKot
                  ? <ActivityIndicator size="small" color={Colors.warning} />
                  : <MaterialIcons name="receipt-long" size={18} color={Colors.warning} />}
                <Text style={[styles.successPrintText, { color: Colors.warning }]}>Print KOT</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.successDoneBtn, { width: '100%', marginTop: 8 }]} onPress={() => { setShowSuccess(null); setCustomerPhone(''); setOrderSource('dine-in'); setParcel(false); }}>
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

  // Categories — vertical list (tablets only)
  catList: { width: CAT_W, backgroundColor: Colors.surface, borderRightWidth: 1, borderRightColor: Colors.border },
  catBtn: { alignItems: 'center', paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: Colors.border },
  catBtnActive: { backgroundColor: Colors.primaryBg, borderLeftWidth: 3, borderLeftColor: Colors.primary },
  catText: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 4, textAlign: 'center', lineHeight: 13 },
  catTextActive: { color: Colors.primary, fontWeight: '700' },

  // Category chips — horizontal scroll (phones only)
  catChipWrap: {
    height: 42,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  catChipContent: { paddingHorizontal: 10, paddingVertical: 4, gap: 7, flexDirection: 'row', alignItems: 'center' },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  catChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catChipText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  catChipTextActive: { color: Colors.white, fontWeight: '700' },

  // Product grid — card tiles with image
  prodGrid: { padding: 5, paddingBottom: 24 },
  prodTile: {
    flex: 1, flexDirection: 'column',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    margin: 4, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
  },
  prodTileActive: { borderColor: Colors.primary, borderWidth: 1.5 },

  // Image section
  prodTileImgWrap: { width: '100%', height: 90, position: 'relative' },
  prodTileImg: { width: '100%', height: '100%' },
  prodTileImgPlaceholder: {
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center',
  },
  vegPill: {
    position: 'absolute', top: 5, left: 5,
    width: 16, height: 16, borderRadius: 3, borderWidth: 1.5,
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  vegDot: { width: 8, height: 8, borderRadius: 4 },
  qtyBadge: {
    position: 'absolute', top: 5, right: 5,
    backgroundColor: Colors.primary, borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  qtyBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '800' },

  // Content below image
  prodTileInner: { padding: 8 },
  prodTileName: { fontSize: 13, fontWeight: '700', color: Colors.text, lineHeight: 18, marginBottom: 4 },
  prodTilePriceRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 7 },
  prodTilePrice: { fontSize: 14, fontWeight: '800', color: Colors.primary },
  prodTileTax: { fontSize: 10, color: Colors.textMuted, fontWeight: '500' },
  prodTileQtyRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.primary, borderRadius: 8, overflow: 'hidden',
  },
  prodTileQtyBtn: { paddingVertical: 7, paddingHorizontal: 12 },
  prodTileQtyNum: { flex: 1, textAlign: 'center', color: Colors.white, fontWeight: '800', fontSize: 13 },
  prodTileAddRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 7,
  },
  prodTileAddText: { fontSize: 12, fontWeight: '800', color: Colors.white },

  // Keep vegBox for cart items
  vegBox: { width: 14, height: 14, borderRadius: 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.md, marginTop: Spacing.md },

  // Cart
  cartPanel: { width: CART_W, backgroundColor: Colors.surface, borderLeftWidth: 1, borderLeftColor: Colors.border },
  cartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cartTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '800' },

  // Source selector
  sourceScroll: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  sourceScrollContent: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, flexDirection: 'row', alignItems: 'center' },
  sourceBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: BorderRadius.round, backgroundColor: Colors.card,
    borderWidth: 1.5, borderColor: Colors.border, marginRight: Spacing.sm,
  },
  sourceEmoji: { fontSize: 14 },
  sourceLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },

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
  cartItemVariant: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '600', marginTop: 1 },
  cartItemUnitPrice: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 1 },
  cartItemRight: { alignItems: 'flex-end' },
  cartItemTotal: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700', marginBottom: 4 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  qtyBtn: { backgroundColor: Colors.primaryBg, borderRadius: 7, width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.primary + '40' },
  qtyNum: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700', minWidth: 22, textAlign: 'center' },
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

  // Promo rows (coupon / gift voucher / wallet)
  promoRow: { paddingHorizontal: Spacing.md, paddingVertical: 4 },
  promoInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.card, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, paddingLeft: Spacing.sm },
  promoInput: { flex: 1, paddingVertical: 7, fontSize: FontSize.sm, color: Colors.text },
  promoBtn: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.md },
  promoBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.xs },
  promoApplied: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.success + '15', borderRadius: BorderRadius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  promoAppliedText: { flex: 1, fontSize: FontSize.sm, color: Colors.success, fontWeight: '600' },

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
  razorpayBtn: { width: 48, height: 48, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.infoBg, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.infoBg },
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
  splitSection:     { gap: Spacing.sm, marginBottom: Spacing.xl },
  splitRow:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  splitMethodLabel: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, width: 44 },
  splitInput:       { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, textAlign: 'right', paddingVertical: 0 },
  splitHint:        { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'right', fontWeight: '600' },
  payActions: { flexDirection: 'row', gap: Spacing.md },
  payCancel: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  payCancelText: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: '600' },
  payConfirm: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.success, paddingVertical: 14, borderRadius: BorderRadius.lg, gap: 8, ...Shadows.success },
  payConfirmText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },

  // Table picker
  tablePickerCard: {
    width: 80, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, gap: 6,
  },
  tablePickerCardOccupied: { borderColor: Colors.danger + '60', backgroundColor: Colors.danger + '08' },
  tablePickerCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  tablePickerName: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  tablePickerStatus: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: BorderRadius.round },
  tablePickerStatusText: { fontSize: FontSize.xs, fontWeight: '700' },

  // Variant picker
  variantRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 14, paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, marginBottom: Spacing.sm,
  },
  variantName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  variantPrice: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary, minWidth: 60, textAlign: 'right' },
  variantAddBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },

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
