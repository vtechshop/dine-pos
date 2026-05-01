import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, TextInput, ActivityIndicator, Image,
  useWindowDimensions, StatusBar, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useCart } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import { getPublicMenu } from '../services/api';
import { Category, Product } from '../types';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { showAlert } from '../utils/alert';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const CustomerMenuScreen: React.FC = () => {
  const { addItem, increment, decrement, cart, itemCount, clearCart } = useCart();
  const { settings } = useSettings();
  const navigation = useNavigation<any>();
  const rootNav = useNavigation<NavProp>();
  const { width: screenWidth } = useWindowDimensions();

  const COLS = screenWidth > 600 ? 3 : 2;
  const CARD_M = Spacing.sm;
  const CARD_W = (screenWidth - CARD_M * (COLS + 1)) / COLS;

  const [categories,    setCategories]   = useState<Category[]>([]);
  const [products,      setProducts]     = useState<Product[]>([]);
  const [filtered,      setFiltered]     = useState<Product[]>([]);
  const [selectedCat,   setSelectedCat]  = useState<string | null>(null);
  const [loading,       setLoading]      = useState(true);
  const [search,        setSearch]       = useState('');
  const [vegOnly,       setVegOnly]      = useState(false);
  const [detailProduct, setDetailProduct]= useState<Product | null>(null);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSecretTap = () => {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (tapCount.current >= 5) { tapCount.current = 0; rootNav.navigate('AdminLogin'); }
    else tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 3000);
  };

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { categories: cats, products: prods } = await getPublicMenu();
      setCategories(cats);
      setProducts(prods);
      setFiltered(prods);
    } catch { /* silent — customer sees empty menu if server unreachable */ }
    finally { setLoading(false); }
  };

  // Centralised filter logic — runs whenever any filter changes
  const applyFilters = useCallback((
    allProds: Product[],
    catId: string | null,
    searchStr: string,
    veg: boolean,
  ) => {
    let result = allProds;
    if (catId) {
      result = result.filter(p => {
        const cid = typeof p.category === 'string' ? p.category : p.category?._id;
        return cid === catId;
      });
    }
    if (searchStr.trim()) {
      result = result.filter(p => p.name.toLowerCase().includes(searchStr.toLowerCase()));
    }
    if (veg) {
      result = result.filter(p => p.isVeg);
    }
    setFiltered(result);
  }, []);

  useEffect(() => {
    applyFilters(products, selectedCat, search, vegOnly);
  }, [products, selectedCat, search, vegOnly, applyFilters]);

  const selectCategory = useCallback((id: string | null) => {
    setSelectedCat(id);
  }, []);

  const getQty = (id: string) => cart.items.find(i => i.product._id === id)?.quantity || 0;
  const cur = settings.currencySymbol || '₹';
  const isMaterialIcon = (name?: string) => !!name && /^[a-z0-9-_]+$/.test(name);

  // ── Category chip ──────────────────────────────────────────────────────────
  const renderCatChip = (cat: Category | null) => {
    const active = cat ? selectedCat === cat._id : selectedCat === null;
    const color = cat?.color || Colors.primary;
    const iconName = cat?.icon;
    return (
      <TouchableOpacity
        key={cat?._id || 'all'}
        style={[styles.catChip, active && { backgroundColor: color, borderColor: color }]}
        onPress={() => selectCategory(cat?._id || null)}
        activeOpacity={0.8}
      >
        {isMaterialIcon(iconName)
          ? <MaterialIcons name={iconName as any} size={15} color={active ? Colors.white : Colors.textSecondary} />
          : iconName
            ? <Text style={{ fontSize: 14, lineHeight: 16 }}>{iconName}</Text>
            : <MaterialIcons name="restaurant-menu" size={15} color={active ? Colors.white : Colors.textSecondary} />
        }
        <Text style={[styles.catChipText, active && { color: Colors.white }]}>{cat?.name || 'All'}</Text>
      </TouchableOpacity>
    );
  };

  // ── Product card ───────────────────────────────────────────────────────────
  const renderProduct = ({ item }: { item: Product }) => {
    const qty = getQty(item._id);
    const unavailable = !item.isAvailable || item.stock === 0;
    const isPopular = !!item.description?.trim();

    return (
      <TouchableOpacity
        style={[styles.prodCard, { width: CARD_W }, unavailable && styles.prodCardUnavailable]}
        onPress={() => !unavailable && setDetailProduct(item)}
        activeOpacity={0.92}
      >
        {/* Image */}
        <View style={styles.prodImgWrap}>
          {item.image
            ? <Image source={{ uri: item.image }} style={styles.prodImg} resizeMode="cover" />
            : <View style={styles.prodImgPlaceholder}><MaterialIcons name="fastfood" size={36} color={Colors.textMuted} /></View>
          }
          {/* Veg/NonVeg badge (FSSAI style) */}
          <View style={[styles.vegBadge, { borderColor: item.isVeg ? Colors.veg : Colors.nonVeg }]}>
            <View style={[styles.vegDot, { backgroundColor: item.isVeg ? Colors.veg : Colors.nonVeg }]} />
          </View>
          {/* Popular badge */}
          {isPopular && !unavailable && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularBadgeText}>⭐ Popular</Text>
            </View>
          )}
          {unavailable && (
            <View style={styles.soldOutOverlay}>
              <Text style={styles.soldOutText}>SOLD OUT</Text>
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.prodInfo}>
          <Text style={styles.prodName} numberOfLines={2}>{item.name}</Text>
          {item.description ? (
            <Text style={styles.prodDesc} numberOfLines={1}>{item.description}</Text>
          ) : null}
          <Text style={styles.prodPrice}>{cur}{item.price.toFixed(0)}</Text>
        </View>

        {/* Add / Qty controls */}
        {!unavailable && (
          qty === 0
            ? (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => addItem(item)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="add" size={18} color={Colors.white} />
                <Text style={styles.addBtnText}>ADD</Text>
              </TouchableOpacity>
            )
            : (
              <View style={styles.qtyControls}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => decrement(item._id)}>
                  <MaterialIcons name="remove" size={18} color={Colors.white} />
                </TouchableOpacity>
                <Text style={styles.qtyNum}>{qty}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => {
                  if (item.stock > 0 && qty >= item.stock) { showAlert('Stock Limit', `Only ${item.stock} available`); return; }
                  increment(item._id);
                }}>
                  <MaterialIcons name="add" size={18} color={Colors.white} />
                </TouchableOpacity>
              </View>
            )
        )}
      </TouchableOpacity>
    );
  };

  // ── Item detail modal ──────────────────────────────────────────────────────
  const renderDetailModal = () => {
    if (!detailProduct) return null;
    const item = detailProduct;
    const qty = getQty(item._id);
    const taxLine = item.taxPercent > 0 ? ` + ${item.taxPercent}% GST` : '';

    return (
      <Modal
        visible={!!detailProduct}
        animationType="slide"
        transparent
        onRequestClose={() => setDetailProduct(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {/* Close handle */}
            <View style={styles.modalHandle} />

            {/* Product image */}
            {item.image
              ? <Image source={{ uri: item.image }} style={styles.modalImage} resizeMode="cover" />
              : (
                <View style={styles.modalImagePlaceholder}>
                  <MaterialIcons name="fastfood" size={64} color={Colors.textMuted} />
                </View>
              )
            }

            <View style={styles.modalBody}>
              {/* Veg badge + Name */}
              <View style={styles.modalNameRow}>
                <View style={[styles.modalVegBadge, { borderColor: item.isVeg ? Colors.veg : Colors.nonVeg }]}>
                  <View style={[styles.vegDot, { backgroundColor: item.isVeg ? Colors.veg : Colors.nonVeg }]} />
                </View>
                <Text style={styles.modalName}>{item.name}</Text>
              </View>

              {/* Tags row */}
              <View style={styles.modalTagsRow}>
                <View style={[styles.modalTag, { backgroundColor: item.isVeg ? Colors.successBg : Colors.dangerBg }]}>
                  <Text style={[styles.modalTagText, { color: item.isVeg ? Colors.veg : Colors.nonVeg }]}>
                    {item.isVeg ? '🌿 Veg' : '🍗 Non-Veg'}
                  </Text>
                </View>
                {item.taxPercent > 0 && (
                  <View style={[styles.modalTag, { backgroundColor: Colors.infoBg }]}>
                    <Text style={[styles.modalTagText, { color: Colors.info }]}>GST {item.taxPercent}%</Text>
                  </View>
                )}
                {item.stock > 0 && item.stock !== -1 && (
                  <View style={[styles.modalTag, { backgroundColor: Colors.warningBg }]}>
                    <Text style={[styles.modalTagText, { color: Colors.warning }]}>{item.stock} left</Text>
                  </View>
                )}
              </View>

              {/* Description */}
              {item.description ? (
                <Text style={styles.modalDesc}>{item.description}</Text>
              ) : null}

              {/* Price */}
              <View style={styles.modalPriceRow}>
                <View>
                  <Text style={styles.modalPrice}>{cur}{item.price.toFixed(0)}</Text>
                  {taxLine ? <Text style={styles.modalPriceSub}>per plate{taxLine}</Text> : null}
                </View>

                {/* Add to cart controls */}
                {qty === 0
                  ? (
                    <TouchableOpacity
                      style={styles.modalAddBtn}
                      onPress={() => { addItem(item); setDetailProduct(null); }}
                      activeOpacity={0.85}
                    >
                      <MaterialIcons name="add-shopping-cart" size={18} color={Colors.white} />
                      <Text style={styles.modalAddBtnText}>Add to Cart</Text>
                    </TouchableOpacity>
                  )
                  : (
                    <View style={styles.modalQtyRow}>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => decrement(item._id)}>
                        <MaterialIcons name="remove" size={18} color={Colors.white} />
                      </TouchableOpacity>
                      <Text style={styles.modalQtyNum}>{qty}</Text>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => {
                        if (item.stock > 0 && qty >= item.stock) { showAlert('Stock Limit', `Only ${item.stock} available`); return; }
                        increment(item._id);
                      }}>
                        <MaterialIcons name="add" size={18} color={Colors.white} />
                      </TouchableOpacity>
                    </View>
                  )
                }
              </View>
            </View>

            {/* Close button */}
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setDetailProduct(null)}>
              <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading menu...</Text>
      </View>
    );
  }

  const vegCount = products.filter(p => p.isVeg).length;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={handleSecretTap} activeOpacity={1} style={{ flex: 1 }}>
            <Text style={styles.hotelName}>{settings.hotelName || 'Menu'}</Text>
            <Text style={styles.hotelSub}>
              {products.length} items · {categories.length} categories
            </Text>
          </TouchableOpacity>
          {/* Veg-only toggle */}
          {vegCount > 0 && (
            <TouchableOpacity
              style={[styles.vegToggle, vegOnly && styles.vegToggleActive]}
              onPress={() => setVegOnly(!vegOnly)}
              activeOpacity={0.8}
            >
              <View style={[styles.vegToggleDot, { backgroundColor: Colors.veg }]} />
              <Text style={[styles.vegToggleText, vegOnly && styles.vegToggleTextActive]}>
                Veg Only
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {/* Search */}
        <View style={styles.searchBar}>
          <MaterialIcons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search dishes..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <MaterialIcons name="close" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Category chips ── */}
      <View style={styles.catBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catBarContent}>
          {renderCatChip(null)}
          {categories.map(c => renderCatChip(c))}
        </ScrollView>
      </View>

      {/* ── Active filters indicator ── */}
      {(vegOnly || search.trim()) && (
        <View style={styles.filterInfo}>
          <MaterialIcons name="filter-list" size={14} color={Colors.primary} />
          <Text style={styles.filterInfoText}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            {vegOnly ? ' · Veg only' : ''}
            {search.trim() ? ` · "${search}"` : ''}
          </Text>
          <TouchableOpacity onPress={() => { setSearch(''); setVegOnly(false); }}>
            <Text style={styles.filterClearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Product grid ── */}
      <FlatList
        key={COLS}
        data={filtered}
        renderItem={renderProduct}
        keyExtractor={i => i._id}
        numColumns={COLS}
        contentContainerStyle={[styles.grid, { padding: CARD_M }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <MaterialIcons name="restaurant" size={60} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No items found</Text>
            {(vegOnly || search) && (
              <TouchableOpacity style={styles.emptyResetBtn} onPress={() => { setSearch(''); setVegOnly(false); }}>
                <Text style={styles.emptyResetText}>Clear filters</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      {/* ── Floating cart bar ── */}
      {itemCount > 0 && (
        <TouchableOpacity style={styles.floatingCart} onPress={() => navigation.navigate('Cart')} activeOpacity={0.92}>
          <View style={styles.floatingCartLeft}>
            <View style={styles.itemCountBadge}>
              <Text style={styles.itemCountText}>{itemCount}</Text>
            </View>
            <Text style={styles.floatingCartLabel}>{itemCount} item{itemCount > 1 ? 's' : ''} added</Text>
          </View>
          <View style={styles.floatingCartRight}>
            <Text style={styles.floatingCartTotal}>{cur}{cart.grandTotal.toFixed(0)}</Text>
            <MaterialIcons name="arrow-forward" size={20} color={Colors.white} />
          </View>
        </TouchableOpacity>
      )}

      {/* ── Item detail modal ── */}
      {renderDetailModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, padding: Spacing.xxl },
  loadingText: { color: Colors.textSecondary, marginTop: Spacing.md, fontSize: FontSize.md },
  blockedTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginTop: Spacing.lg, textAlign: 'center' },
  blockedSub: { fontSize: FontSize.md, color: Colors.textSecondary, marginTop: Spacing.sm, textAlign: 'center', lineHeight: 22 },

  // Header
  header: {
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTop: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: Spacing.md, gap: Spacing.md,
  },
  hotelName: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.text },
  hotelSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: FontSize.md, color: Colors.text },

  // Veg toggle
  vegToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: BorderRadius.round, borderWidth: 1.5,
    borderColor: Colors.veg + '60', backgroundColor: Colors.surface,
  },
  vegToggleActive: {
    backgroundColor: Colors.successBg,
    borderColor: Colors.veg,
  },
  vegToggleDot: { width: 10, height: 10, borderRadius: 2, borderWidth: 1.5, borderColor: Colors.veg },
  vegToggleText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary },
  vegToggleTextActive: { color: Colors.veg },

  // Category chips
  catBar: { backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  catBarContent: { paddingHorizontal: Spacing.md, paddingVertical: 10, gap: Spacing.sm, flexDirection: 'row', alignItems: 'center' },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: BorderRadius.round, backgroundColor: Colors.card,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  catChipText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '700' },

  // Filter info bar
  filterInfo: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    backgroundColor: Colors.primaryBg, borderBottomWidth: 1, borderBottomColor: Colors.primary + '30',
  },
  filterInfoText: { flex: 1, color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
  filterClearText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '800', textDecorationLine: 'underline' },

  // Product grid
  grid: { paddingBottom: 100 },
  prodCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.xl,
    margin: Spacing.sm / 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  prodCardUnavailable: { opacity: 0.55 },
  prodImgWrap: { width: '100%', position: 'relative' },
  prodImg: { width: '100%', height: 130 },
  prodImgPlaceholder: { width: '100%', height: 130, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },

  vegBadge: {
    position: 'absolute', top: 8, left: 8,
    width: 16, height: 16, borderRadius: 3, borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center',
  },
  vegDot: { width: 8, height: 8, borderRadius: 4 },

  popularBadge: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(230,81,0,0.85)',
    paddingVertical: 3, alignItems: 'center',
  },
  popularBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  soldOutOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  soldOutText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '800', letterSpacing: 1 },

  prodInfo: { padding: Spacing.md, paddingBottom: Spacing.sm },
  prodName: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700', marginBottom: 2, lineHeight: 20 },
  prodDesc: { color: Colors.textMuted, fontSize: FontSize.xs, marginBottom: 4, lineHeight: 16 },
  prodPrice: { color: Colors.primary, fontSize: FontSize.xl, fontWeight: '900' },

  // Add button
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    marginHorizontal: Spacing.md, marginBottom: Spacing.md,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md, paddingVertical: 9,
    ...Shadows.primary,
  },
  addBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  // Qty controls
  qtyControls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: Spacing.md, marginBottom: Spacing.md, gap: Spacing.md,
  },
  qtyBtn: { backgroundColor: Colors.primary, borderRadius: 8, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  qtyNum: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '800', minWidth: 28, textAlign: 'center' },

  // Empty state
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.lg, marginTop: Spacing.md },
  emptyResetBtn: { marginTop: Spacing.lg, backgroundColor: Colors.primaryBg, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.primary + '40' },
  emptyResetText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },

  // Floating cart
  floatingCart: {
    position: 'absolute', bottom: 14, left: 14, right: 14,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.xl,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: Spacing.lg, paddingHorizontal: Spacing.xl,
    ...Shadows.primary,
  },
  floatingCartLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  itemCountBadge: {
    backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: BorderRadius.round,
    width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
  },
  itemCountText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },
  floatingCartLabel: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },
  floatingCartRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  floatingCartTotal: { color: Colors.white, fontSize: FontSize.xl, fontWeight: '900' },

  // Item detail modal
  modalOverlay: {
    flex: 1, backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxxl,
    borderTopRightRadius: BorderRadius.xxxl,
    overflow: 'hidden',
    maxHeight: '88%',
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    position: 'absolute', top: 12, zIndex: 10,
  },
  modalImage: { width: '100%', height: 220 },
  modalImagePlaceholder: {
    width: '100%', height: 180,
    backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  modalBody: { padding: Spacing.xl, paddingTop: Spacing.lg },
  modalNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  modalVegBadge: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 2,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  modalName: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, flex: 1 },
  modalTagsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md, flexWrap: 'wrap' },
  modalTag: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: BorderRadius.round },
  modalTagText: { fontSize: FontSize.xs, fontWeight: '700' },
  modalDesc: {
    fontSize: FontSize.md, color: Colors.textSecondary, lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  modalPriceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  modalPrice: { fontSize: FontSize.xxxl, fontWeight: '900', color: Colors.primary },
  modalPriceSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  modalAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.xl,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxl,
    ...Shadows.primary,
  },
  modalAddBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
  modalQtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  modalQtyNum: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '900', minWidth: 32, textAlign: 'center' },
  modalCloseBtn: {
    position: 'absolute', top: 16, right: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
    ...Shadows.sm,
  },
});

export default CustomerMenuScreen;
