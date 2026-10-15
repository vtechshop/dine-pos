import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
  TextInput, ActivityIndicator, StatusBar, Dimensions, Image,
  Modal, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, Product, Category, SelectedModifier, ModifierGroup } from '../types';
import { getPublicMenu, createWaiterOrder } from '../services/api';
import { applyCloudinaryTransform } from '../utils/cloudinary';
import { Colors, FontSize, Spacing, BorderRadius, Shadows } from '../utils/constants';

type Props = NativeStackScreenProps<RootStackParamList, 'WaiterTakeOrder'>;

interface CartItem {
  productId:         string;
  productName:       string;
  basePrice:         number;
  taxPercent:        number;
  quantity:          number;
  image?:            string | null;
  selectedModifiers: SelectedModifier[];
  modifierTotal:     number;
}

const { width: SW } = Dimensions.get('window');
const COLS     = 2;
const CARD_W   = Math.floor((SW - 32 - 10) / COLS);
const IMG_H    = Math.round(CARD_W * 0.52);

// ── Inline ProductImage with onError fallback ────────────────────────────────
const ProductImage: React.FC<{ uri: string; imgStyle: any; fallback: React.ReactNode }> = ({ uri, imgStyle, fallback }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback as React.ReactElement;
  return <Image source={{ uri }} style={imgStyle} resizeMode="cover" onError={() => setFailed(true)} />;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number, currency = '₹') => `${currency}${n.toFixed(2).replace(/\.00$/, '')}`;

const cartTotal = (items: CartItem[]) =>
  items.reduce((s, it) => s + (it.basePrice + it.modifierTotal) * it.quantity, 0);

export default function WaiterTakeOrderScreen({ navigation, route }: Props) {
  const { tableNumber, tableName } = route.params;
  const { top, bottom } = useSafeAreaInsets();

  const [loading,       setLoading]       = useState(true);
  const [products,      setProducts]      = useState<Product[]>([]);
  const [categories,    setCategories]    = useState<Category[]>([]);
  const [currency,      setCurrency]      = useState('₹');
  const [selectedCat,   setSelectedCat]   = useState<string | null>(null);
  const [search,        setSearch]        = useState('');
  const [cart,          setCart]          = useState<CartItem[]>([]);
  const [cartOpen,      setCartOpen]      = useState(false);
  const [notes,         setNotes]         = useState('');
  const [placing,       setPlacing]       = useState(false);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  // Modifier selection state (for detail modal)
  const [selectedMods,  setSelectedMods]  = useState<Record<string, SelectedModifier>>({});

  useEffect(() => {
    (async () => {
      try {
        const { products: prods, categories: cats, hotel } = await getPublicMenu();
        setProducts(prods);
        setCategories(cats.filter(c => c.isActive));
        setCurrency(hotel.currency || '₹');
      } catch {
        Alert.alert('Error', 'Failed to load menu. Check your connection.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Cart helpers ──────────────────────────────────────────────────────────
  const getCartItem = (productId: string) => cart.find(i => i.productId === productId);

  const addToCart = useCallback((product: Product, mods: SelectedModifier[] = []) => {
    const modTotal = mods.reduce((s, m) => s + (m.modifierPrice || 0), 0);
    setCart(prev => {
      const existing = prev.find(i => i.productId === product._id);
      if (existing && mods.length === 0) {
        return prev.map(i => i.productId === product._id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        productId:         product._id,
        productName:       product.name,
        basePrice:         product.price,
        taxPercent:        product.taxPercent ?? 0,
        quantity:          1,
        image:             product.image || null,
        selectedModifiers: mods,
        modifierTotal:     modTotal,
      }];
    });
    setDetailProduct(null);
    setSelectedMods({});
  }, []);

  const increment = (productId: string) =>
    setCart(prev => prev.map(i => i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i));

  const decrement = (productId: string) =>
    setCart(prev => {
      const item = prev.find(i => i.productId === productId);
      if (!item) return prev;
      if (item.quantity <= 1) return prev.filter(i => i.productId !== productId);
      return prev.map(i => i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i);
    });

  const totalQty    = cart.reduce((s, i) => s + i.quantity, 0);
  const totalAmount = cartTotal(cart);

  // ── Send KOT ──────────────────────────────────────────────────────────────
  const handleSendKOT = async () => {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      const result = await createWaiterOrder({
        tableNumber,
        customerName:  `Table ${tableNumber}`,
        customerPhone: '0000000000',
        notes:         notes.trim(),
        items: cart.map(i => ({
          product:           i.productId,
          productName:       i.productName,
          quantity:          i.quantity,
          price:             i.basePrice,
          taxPercent:        i.taxPercent,
          selectedModifiers: i.selectedModifiers,
        })),
      });
      Alert.alert(
        '✅ KOT Sent!',
        `Order ${result.orderNumber} sent to kitchen for Table ${tableNumber}.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e: any) {
      Alert.alert('Order Failed', e?.message || 'Could not send order. Try again.');
    } finally {
      setPlacing(false);
    }
  };

  // ── Modifier modal helpers ────────────────────────────────────────────────
  const openDetail = (product: Product) => {
    const hasModifiers = (product.modifierGroups?.length ?? 0) > 0;
    if (hasModifiers) {
      setSelectedMods({});
      setDetailProduct(product);
    } else {
      addToCart(product);
    }
  };

  const toggleMod = (group: ModifierGroup, opt: { _id: string; name: string; price: number }) => {
    if (group.selectionType === 'single') {
      setSelectedMods(prev => ({
        ...prev,
        [group._id]: {
          modifierGroupId:    group._id,
          modifierGroupName:  group.name,
          modifierOptionId:   opt._id,
          modifierOptionName: opt.name,
          modifierPrice:      opt.price,
          modifierTotal:      opt.price,
        },
      }));
    } else {
      setSelectedMods(prev => {
        const key = `${group._id}:${opt._id}`;
        if (prev[key]) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return {
          ...prev,
          [key]: {
            modifierGroupId:    group._id,
            modifierGroupName:  group.name,
            modifierOptionId:   opt._id,
            modifierOptionName: opt.name,
            modifierPrice:      opt.price,
            modifierTotal:      opt.price,
          },
        };
      });
    }
  };

  const confirmDetail = () => {
    if (!detailProduct) return;
    const mods = Object.values(selectedMods);
    // Check required groups
    for (const g of detailProduct.modifierGroups ?? []) {
      if (g.isRequired) {
        const hasSel = mods.some(m => m.modifierGroupId === g._id);
        if (!hasSel) { Alert.alert('Required', `Please select an option for "${g.name}"`); return; }
      }
    }
    addToCart(detailProduct, mods);
  };

  // ── Filtered products ─────────────────────────────────────────────────────
  const visible = products.filter(p => {
    if (!p.isAvailable) return false;
    if (selectedCat) {
      const catId = typeof p.category === 'string' ? p.category : (p.category as Category)._id;
      if (catId !== selectedCat) return false;
    }
    if (search.trim()) return p.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  // ── Product card ──────────────────────────────────────────────────────────
  const renderProduct = ({ item }: { item: Product }) => {
    const inCart = getCartItem(item._id);
    const imageUri = item.image && item.imageStatus !== 'placeholder'
      ? applyCloudinaryTransform(item.image, 400, 400) ?? item.image
      : null;
    return (
      <View style={[styles.card, { width: CARD_W }]}>
        <TouchableOpacity onPress={() => openDetail(item)} activeOpacity={0.88}>
          {/* Image */}
          <View style={[styles.imgWrap, { height: IMG_H }]}>
            {imageUri
              ? <ProductImage uri={imageUri} imgStyle={styles.img} fallback={<View style={styles.imgPlaceholder}><MaterialIcons name="fastfood" size={Math.round(IMG_H * 0.3)} color={Colors.textMuted} /></View>} />
              : <View style={styles.imgPlaceholder}><MaterialIcons name="fastfood" size={Math.round(IMG_H * 0.3)} color={Colors.textMuted} /></View>
            }
            {!item.isVeg && (
              <View style={styles.vegBadge}>
                <View style={[styles.vegDot, { backgroundColor: Colors.nonVeg }]} />
              </View>
            )}
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.productPrice}>{fmt(item.price, currency)}</Text>
          </View>
        </TouchableOpacity>
        {/* Add / qty controls */}
        <View style={styles.cardFooter}>
          {inCart ? (
            <View style={styles.qtyRow}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => decrement(item._id)} activeOpacity={0.8}>
                <MaterialIcons name="remove" size={16} color={Colors.primary} />
              </TouchableOpacity>
              <Text style={styles.qtyText}>{inCart.quantity}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => increment(item._id)} activeOpacity={0.8}>
                <MaterialIcons name="add" size={16} color={Colors.primary} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.addBtn} onPress={() => openDetail(item)} activeOpacity={0.85}>
              <MaterialIcons name="add" size={16} color={Colors.white} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ marginTop: 12, color: Colors.textSecondary }}>Loading menu…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Table {tableNumber}{tableName ? ` — ${tableName}` : ''}</Text>
          <Text style={styles.headerSub}>Take order · Pay at counter</Text>
        </View>
        {totalQty > 0 && (
          <TouchableOpacity style={styles.cartBtn} onPress={() => setCartOpen(true)} activeOpacity={0.85}>
            <MaterialIcons name="shopping-cart" size={20} color={Colors.white} />
            <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{totalQty}</Text></View>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Search ── */}
      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={18} color={Colors.textMuted} style={{ marginLeft: 12 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search menu…"
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={{ paddingRight: 12 }}>
            <MaterialIcons name="close" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Category chips ── */}
      {categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
          <TouchableOpacity
            style={[styles.catChip, !selectedCat && styles.catChipActive]}
            onPress={() => setSelectedCat(null)}
            activeOpacity={0.8}
          >
            <Text style={[styles.catChipText, !selectedCat && styles.catChipTextActive]}>All</Text>
          </TouchableOpacity>
          {categories.map(cat => (
            <TouchableOpacity
              key={cat._id}
              style={[styles.catChip, selectedCat === cat._id && styles.catChipActive]}
              onPress={() => setSelectedCat(cat._id === selectedCat ? null : cat._id)}
              activeOpacity={0.8}
            >
              {cat.icon ? <Text style={{ fontSize: 13 }}>{cat.icon}</Text> : null}
              <Text style={[styles.catChipText, selectedCat === cat._id && styles.catChipTextActive]}>{cat.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── Product grid ── */}
      {visible.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <MaterialIcons name="search-off" size={48} color={Colors.textMuted} />
          <Text style={{ color: Colors.textSecondary, fontSize: FontSize.md }}>No items found</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={p => p._id}
          renderItem={renderProduct}
          numColumns={COLS}
          columnWrapperStyle={{ gap: 10, paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: bottom + (totalQty > 0 ? 80 : 20) }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}

      {/* ── Bottom KOT bar ── */}
      {totalQty > 0 && !cartOpen && (
        <TouchableOpacity style={[styles.kotBar, { paddingBottom: bottom + 12 }]} onPress={() => setCartOpen(true)} activeOpacity={0.9}>
          <View style={styles.kotLeft}>
            <Text style={styles.kotQty}>{totalQty} item{totalQty !== 1 ? 's' : ''}</Text>
            <Text style={styles.kotTotal}>{fmt(totalAmount, currency)}</Text>
          </View>
          <View style={styles.kotRight}>
            <Text style={styles.kotBtnText}>Review Order</Text>
            <MaterialIcons name="arrow-forward" size={18} color={Colors.white} />
          </View>
        </TouchableOpacity>
      )}

      {/* ── Cart sheet (modal) ── */}
      <Modal visible={cartOpen} transparent animationType="slide" onRequestClose={() => setCartOpen(false)}>
        <View style={styles.cartSheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setCartOpen(false)} activeOpacity={1} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.cartSheet, { paddingBottom: bottom + 16 }]}>
              {/* Sheet header */}
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Table {tableNumber} — Order</Text>
                <TouchableOpacity onPress={() => setCartOpen(false)}>
                  <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Cart items */}
              <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
                {cart.map(item => (
                  <View key={item.productId} style={styles.cartRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cartItemName} numberOfLines={1}>{item.productName}</Text>
                      {item.selectedModifiers.length > 0 && (
                        <Text style={styles.cartModNote} numberOfLines={1}>
                          {item.selectedModifiers.map(m => m.modifierOptionName).join(', ')}
                        </Text>
                      )}
                      <Text style={styles.cartItemPrice}>{fmt((item.basePrice + item.modifierTotal) * item.quantity, currency)}</Text>
                    </View>
                    <View style={styles.qtyRow}>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => decrement(item.productId)} activeOpacity={0.8}>
                        <MaterialIcons name="remove" size={15} color={Colors.primary} />
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{item.quantity}</Text>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => increment(item.productId)} activeOpacity={0.8}>
                        <MaterialIcons name="add" size={15} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>

              {/* Notes */}
              <View style={styles.notesBox}>
                <MaterialIcons name="notes" size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.notesInput}
                  placeholder="Add note for kitchen (optional)"
                  placeholderTextColor={Colors.textMuted}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  maxLength={200}
                />
              </View>

              {/* Total + KOT button */}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalAmount}>{fmt(totalAmount, currency)}</Text>
              </View>
              <TouchableOpacity
                style={[styles.kotSendBtn, placing && { opacity: 0.6 }]}
                onPress={handleSendKOT}
                disabled={placing}
                activeOpacity={0.88}
              >
                {placing
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <><MaterialIcons name="send" size={20} color={Colors.white} /><Text style={styles.kotSendText}>Send KOT to Kitchen</Text></>
                }
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Product detail / modifier modal ── */}
      {detailProduct && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setDetailProduct(null)}>
          <View style={styles.cartSheetOverlay}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => setDetailProduct(null)} activeOpacity={1} />
            <View style={[styles.cartSheet, { paddingBottom: bottom + 16 }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{detailProduct.name}</Text>
                <TouchableOpacity onPress={() => setDetailProduct(null)}>
                  <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.detailPrice}>{fmt(detailProduct.price, currency)}</Text>
              {detailProduct.description ? <Text style={styles.detailDesc}>{detailProduct.description}</Text> : null}

              <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                {(detailProduct.modifierGroups ?? []).map(g => (
                  <View key={g._id} style={styles.modGroup}>
                    <Text style={styles.modGroupName}>
                      {g.name}{g.isRequired ? ' *' : ''}
                      <Text style={styles.modGroupSub}> · {g.selectionType === 'single' ? 'Choose one' : 'Choose any'}</Text>
                    </Text>
                    {g.options.filter(o => o.isActive).map(opt => {
                      const key = g.selectionType === 'single' ? g._id : `${g._id}:${opt._id}`;
                      const chosen = g.selectionType === 'single'
                        ? selectedMods[g._id]?.modifierOptionId === opt._id
                        : !!selectedMods[`${g._id}:${opt._id}`];
                      return (
                        <TouchableOpacity key={opt._id} style={styles.modOption} onPress={() => toggleMod(g, opt)} activeOpacity={0.8}>
                          <View style={[styles.modCheck, chosen && styles.modCheckActive]}>
                            {chosen && <MaterialIcons name={g.selectionType === 'single' ? 'radio-button-checked' : 'check'} size={14} color={Colors.white} />}
                          </View>
                          <Text style={styles.modOptName}>{opt.name}</Text>
                          {opt.price > 0 && <Text style={styles.modOptPrice}>+{fmt(opt.price, currency)}</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>

              <TouchableOpacity style={styles.kotSendBtn} onPress={confirmDetail} activeOpacity={0.88}>
                <MaterialIcons name="add-shopping-cart" size={20} color={Colors.white} />
                <Text style={styles.kotSendText}>Add to Order</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.background },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, ...Shadows.sm, gap: 10 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  headerSub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  cartBtn:     { position: 'relative', backgroundColor: Colors.primary, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cartBadge:   { position: 'absolute', top: -4, right: -4, backgroundColor: Colors.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  cartBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '900' },

  // Search
  searchWrap:  { flexDirection: 'row', alignItems: 'center', margin: 12, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, height: 42, gap: 4 },
  searchInput: { flex: 1, height: 42, paddingHorizontal: 8, fontSize: FontSize.md, color: Colors.text },

  // Categories
  catRow:      { paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row' },
  catChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1.5, borderColor: Colors.border },
  catChipActive:{ backgroundColor: Colors.primary, borderColor: Colors.primary },
  catChipText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  catChipTextActive: { color: Colors.white },

  // Product cards
  card:        { backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, ...Shadows.sm },
  imgWrap:     { width: '100%', overflow: 'hidden', backgroundColor: Colors.elevated },
  img:         { width: '100%', height: '100%' },
  imgPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.elevated },
  vegBadge:    { position: 'absolute', top: 6, right: 6, backgroundColor: Colors.surface, borderRadius: 4, padding: 3, borderWidth: 1.5, borderColor: Colors.border },
  vegDot:      { width: 8, height: 8, borderRadius: 4 },
  cardBody:    { padding: 10, gap: 3 },
  productName: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, lineHeight: 17 },
  productPrice:{ fontSize: FontSize.md, fontWeight: '900', color: Colors.primary },
  cardFooter:  { paddingHorizontal: 10, paddingBottom: 10 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: 8 },
  addBtnText:  { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  qtyRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.primaryBg ?? Colors.background, borderRadius: BorderRadius.md, padding: 2 },
  qtyBtn:      { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  qtyText:     { fontSize: FontSize.md, fontWeight: '800', color: Colors.text, minWidth: 24, textAlign: 'center' },

  // Bottom KOT bar
  kotBar:      { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.primary, paddingHorizontal: 20, paddingTop: 14 },
  kotLeft:     { gap: 2 },
  kotQty:      { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)' },
  kotTotal:    { fontSize: FontSize.xl, fontWeight: '900', color: Colors.white },
  kotRight:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kotBtnText:  { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },

  // Cart / detail sheet
  cartSheetOverlay: { flex: 1, backgroundColor: Colors.overlay },
  cartSheet:   { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle:  { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  cartRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 12 },
  cartItemName:{ fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  cartModNote: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  cartItemPrice:{ fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary, marginTop: 2 },
  notesBox:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: 10, marginTop: 12, borderWidth: 1, borderColor: Colors.border },
  notesInput:  { flex: 1, fontSize: FontSize.sm, color: Colors.text, maxHeight: 80 },
  totalRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: 1.5, borderTopColor: Colors.border },
  totalLabel:  { fontSize: FontSize.md, fontWeight: '700', color: Colors.textSecondary },
  totalAmount: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.text },
  kotSendBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.primary, borderRadius: BorderRadius.lg, paddingVertical: 16, marginTop: 12 },
  kotSendText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },

  // Detail modal
  detailPrice: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.primary, marginBottom: 4 },
  detailDesc:  { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  modGroup:    { marginBottom: 14 },
  modGroupName:{ fontSize: FontSize.md, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  modGroupSub: { fontSize: FontSize.xs, fontWeight: '400', color: Colors.textMuted },
  modOption:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  modCheck:    { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  modCheckActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modOptName:  { flex: 1, fontSize: FontSize.md, color: Colors.text },
  modOptPrice: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.success },
});
