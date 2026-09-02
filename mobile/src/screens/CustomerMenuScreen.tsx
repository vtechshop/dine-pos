import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ScrollView,
  StyleSheet, TextInput, ActivityIndicator, Image,
  useWindowDimensions, StatusBar, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useCart } from '../context/CartContext';
import { useSettings } from '../context/SettingsContext';
import { getPublicMenu, getEffectiveHotelId, saveMenuCache, loadMenuCache, getKioskHotelId } from '../services/api';
import { Category, Product, SelectedModifier, ModifierGroup } from '../types';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import { applyCloudinaryTransform } from '../utils/cloudinary';
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
  const { bottom } = useSafeAreaInsets();

  const isTablet = screenWidth >= 600;
  const COLS = 2; // Always 2 columns — better card size on both phone and tablet
  const CARD_M = isTablet ? Spacing.md : Spacing.sm;
  const CARD_W = (screenWidth - CARD_M * (COLS + 1)) / COLS;
  const IMG_H = Math.round(CARD_W * 0.62); // Proportional image height based on card width
  const CARD_FONT = isTablet ? FontSize.lg : FontSize.md;
  const PRICE_FONT = isTablet ? FontSize.xxl : FontSize.xl;

  const [categories,         setCategories]          = useState<Category[]>([]);
  const [products,           setProducts]            = useState<Product[]>([]);
  const [filtered,           setFiltered]            = useState<Product[]>([]);
  const [selectedCat,        setSelectedCat]         = useState<string | null>(null);
  const [loading,            setLoading]             = useState(true);
  const [search,             setSearch]              = useState('');
  const [foodFilter,         setFoodFilter]          = useState<'all' | 'veg' | 'non-veg'>('all');
  const [detailProduct,      setDetailProduct]       = useState<Product | null>(null);
  const [variantPickerProduct, setVariantPickerProduct] = useState<Product | null>(null);
  const [modifierPicker, setModifierPicker] = useState<{ product: Product; effectivePrice: number; variantId?: string; variantName?: string } | null>(null);
  const [modSelections, setModSelections] = useState<Record<string, string[]>>({});
  const [isOffline,          setIsOffline]           = useState(false);
  const [isKioskDevice,      setIsKioskDevice]       = useState(false);

  // Use kiosk channel price when device is locked as a kiosk; fall back to QR price, then base price.
  const qrPrice = (p: Product): number => {
    if (isKioskDevice) {
      const kp = p.channelPrices?.kiosk;
      if (kp && kp > 0) return kp;
    }
    const cp = p.channelPrices?.qr;
    return cp && cp > 0 ? cp : p.price;
  };
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
    setLoading(true);
    try {
      const kioskId = await getKioskHotelId();
      setIsKioskDevice(!!kioskId);
      const { categories: cats, products: prods } = await getPublicMenu();
      setCategories(cats);
      setProducts(prods);
      setFiltered(prods);
      setIsOffline(false);
      // Persist for offline use
      const hotelId = await getEffectiveHotelId();
      if (hotelId) saveMenuCache(hotelId, cats, prods).catch(() => {});
    } catch {
      // No network — try cached menu
      const hotelId = await getEffectiveHotelId();
      const cached = hotelId ? await loadMenuCache(hotelId) : null;
      if (cached) {
        setCategories(cached.categories);
        setProducts(cached.products);
        setFiltered(cached.products);
        setIsOffline(true);
      }
    } finally {
      setLoading(false);
    }
  };

  // Centralised filter logic — runs whenever any filter changes
  const applyFilters = useCallback((
    allProds: Product[],
    catId: string | null,
    searchStr: string,
    filter: 'all' | 'veg' | 'non-veg',
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
    if (filter === 'veg') result = result.filter(p => p.isVeg);
    if (filter === 'non-veg') result = result.filter(p => !p.isVeg);
    setFiltered(result);
  }, []);

  useEffect(() => {
    applyFilters(products, selectedCat, search, foodFilter);
  }, [products, selectedCat, search, foodFilter, applyFilters]);

  const selectCategory = useCallback((id: string | null) => {
    setSelectedCat(id);
  }, []);

  const getQty = (id: string) => cart.items.filter(i => i.product._id === id).reduce((sum, i) => sum + i.quantity, 0);
  const cur = settings.currencySymbol || '₹';
  const isMaterialIcon = (name?: string) => !!name && /^[a-z0-9-_]+$/.test(name);

  const openModifiersOrAdd = (product: Product, effectivePrice: number, variantId?: string, variantName?: string) => {
    const mgs = (product.modifierGroups || []).filter((g: ModifierGroup) => g.isActive);
    if (mgs.length > 0) {
      const init: Record<string, string[]> = {};
      mgs.forEach((g: ModifierGroup) => { init[g._id] = []; });
      setModSelections(init);
      setModifierPicker({ product, effectivePrice, variantId, variantName });
    } else {
      addItem(product, effectivePrice, variantId, variantName);
    }
  };

  const buildSelectedModifiers = (product: Product): SelectedModifier[] => {
    const groups = (product.modifierGroups || []).filter((g: ModifierGroup) => g.isActive);
    const result: SelectedModifier[] = [];
    groups.forEach((group: ModifierGroup) => {
      const chosen = modSelections[group._id] || [];
      chosen.forEach(optId => {
        const opt = group.options.find(o => o._id === optId);
        if (opt) result.push({ modifierGroupId: group._id, modifierGroupName: group.name, modifierOptionId: opt._id, modifierOptionName: opt.name, modifierPrice: opt.price, modifierTotal: opt.price });
      });
    });
    return result;
  };

  const validateAndConfirmModifiers = () => {
    if (!modifierPicker) return;
    const groups = (modifierPicker.product.modifierGroups || []).filter((g: ModifierGroup) => g.isActive);
    for (const group of groups as ModifierGroup[]) {
      const chosen = (modSelections[group._id] || []).length;
      if (group.isRequired && chosen < (group.minSelections || 1)) {
        showAlert('Selection Required', `"${group.name}" requires at least ${group.minSelections || 1} selection(s).`);
        return;
      }
    }
    const selectedModifiers = buildSelectedModifiers(modifierPicker.product);
    addItem(modifierPicker.product, modifierPicker.effectivePrice, modifierPicker.variantId, modifierPicker.variantName, selectedModifiers);
    setModifierPicker(null);
  };

  // ── Category chip ──────────────────────────────────────────────────────────
  const renderCatChip = (cat: Category | null) => {
    const active = cat ? selectedCat === cat._id : selectedCat === null;
    const color = Colors.primary;
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
          {item.image && item.imageStatus !== 'placeholder'
            ? <Image source={{ uri: applyCloudinaryTransform(item.image, 600, 600) ?? item.image }} style={[styles.prodImg, { height: IMG_H }]} resizeMode="cover" />
            : <View style={[styles.prodImgPlaceholder, { height: IMG_H }]}><MaterialIcons name="fastfood" size={Math.round(IMG_H * 0.28)} color={Colors.textMuted} /></View>
          }
          {/* Non-veg warning badge only */}
          {!item.isVeg && (
            <View style={[styles.vegBadge, { borderColor: Colors.nonVeg }]}>
              <View style={[styles.vegDot, { backgroundColor: Colors.nonVeg }]} />
            </View>
          )}
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
          <Text style={[styles.prodName, { fontSize: CARD_FONT }]} numberOfLines={2}>{item.name}</Text>
          {item.description ? (
            <Text style={styles.prodDesc} numberOfLines={1}>{item.description}</Text>
          ) : null}
          <Text style={[styles.prodPrice, { fontSize: PRICE_FONT }]}>{cur}{qrPrice(item).toFixed(0)}</Text>
        </View>

        {/* Add / Qty controls */}
        {!unavailable && (
          qty === 0 || (item.variants?.length ?? 0) > 0
            ? (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => (item.variants?.length ?? 0) > 0 ? setVariantPickerProduct(item) : openModifiersOrAdd(item, qrPrice(item))}
                activeOpacity={0.8}
              >
                <MaterialIcons name={(item.variants?.length ?? 0) > 0 ? 'expand-more' : 'add'} size={18} color={Colors.white} />
                <Text style={styles.addBtnText}>{(item.variants?.length ?? 0) > 0 ? 'CHOOSE' : 'ADD'}</Text>
              </TouchableOpacity>
            )
            : (
              <View style={styles.qtyControls}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => decrement(`${item._id}:base`)}>
                  <MaterialIcons name="remove" size={18} color={Colors.white} />
                </TouchableOpacity>
                <Text style={styles.qtyNum}>{qty}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => {
                  if (item.stock > 0 && qty >= item.stock) { showAlert('Stock Limit', `Only ${item.stock} available`); return; }
                  increment(`${item._id}:base`);
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

    return (
      <Modal
        visible={!!detailProduct}
        animationType="slide"
        transparent
        onRequestClose={() => setDetailProduct(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottom }]}>
            {/* Close handle */}
            <View style={styles.modalHandle} />

            {/* Product image */}
            {item.image && item.imageStatus !== 'placeholder'
              ? <Image source={{ uri: applyCloudinaryTransform(item.image, 600, 600) ?? item.image }} style={styles.modalImage} resizeMode="contain" />
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

              {/* Price breakdown */}
              {(() => {
                const ep  = qrPrice(item);
                const gst = item.taxPercent > 0 ? (ep * item.taxPercent) / 100 : 0;
                const total = ep + gst;
                return (
                  <View style={styles.priceBox}>
                    <View style={styles.priceRow}>
                      <Text style={styles.priceLabel}>Menu Price</Text>
                      <Text style={styles.priceValue}>{cur}{ep.toFixed(2)}</Text>
                    </View>
                    {gst > 0 && (
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>GST ({item.taxPercent}%)</Text>
                        <Text style={styles.priceValue}>+ {cur}{gst.toFixed(2)}</Text>
                      </View>
                    )}
                    <View style={styles.priceDivider} />
                    <View style={styles.priceRow}>
                      <Text style={styles.priceTotalLabel}>Total</Text>
                      <Text style={styles.priceTotalValue}>{cur}{total.toFixed(2)}</Text>
                    </View>
                  </View>
                );
              })()}

              {/* Add to cart controls */}
              {qty === 0 || (item.variants?.length ?? 0) > 0
                ? (
                  <TouchableOpacity
                    style={styles.modalAddBtn}
                    onPress={() => {
                      setDetailProduct(null);
                      if ((item.variants?.length ?? 0) > 0) {
                        setVariantPickerProduct(item);
                      } else {
                        openModifiersOrAdd(item, qrPrice(item));
                      }
                    }}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="add-shopping-cart" size={18} color={Colors.white} />
                    <Text style={styles.modalAddBtnText}>{(item.variants?.length ?? 0) > 0 ? 'Choose Variant' : 'Add to Cart'}</Text>
                  </TouchableOpacity>
                )
                : (
                  <View style={styles.modalQtyRow}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => decrement(`${item._id}:base`)}>
                      <MaterialIcons name="remove" size={18} color={Colors.white} />
                    </TouchableOpacity>
                    <Text style={styles.modalQtyNum}>{qty}</Text>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => {
                      if (item.stock > 0 && qty >= item.stock) { showAlert('Stock Limit', `Only ${item.stock} available`); return; }
                      increment(`${item._id}:base`);
                    }}>
                      <MaterialIcons name="add" size={18} color={Colors.white} />
                    </TouchableOpacity>
                  </View>
                )
              }
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
      <StatusBar barStyle="light-content" backgroundColor={Colors.primary} />

      {/* Offline banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <MaterialIcons name="wifi-off" size={14} color={Colors.white} />
          <Text style={styles.offlineBannerText}>Offline — showing cached menu. Orders will sync when online.</Text>
        </View>
      )}

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: Spacing.md }]}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={handleSecretTap} activeOpacity={1} style={{ flex: 1 }}>
            <Text style={styles.hotelName}>{settings.hotelName || 'Menu'}</Text>
            <Text style={styles.hotelSub}>
              {products.length} items · {categories.length} categories
            </Text>
          </TouchableOpacity>
          {/* Veg / Non-Veg filter */}
          <View style={styles.foodFilterRow}>
            {(['all', 'veg', 'non-veg'] as const).map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.foodFilterBtn, foodFilter === type && styles.foodFilterBtnActive]}
                onPress={() => setFoodFilter(type)}
                activeOpacity={0.8}
              >
                <Text style={[styles.foodFilterText, foodFilter === type && styles.foodFilterTextActive]}>
                  {type === 'all' ? 'All' : type === 'veg' ? '🌿 Veg' : '🍗 Non-Veg'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
      {(foodFilter !== 'all' || search.trim()) && (
        <View style={styles.filterInfo}>
          <MaterialIcons name="filter-list" size={14} color={Colors.primary} />
          <Text style={styles.filterInfoText}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            {foodFilter === 'veg' ? ' · Veg only' : foodFilter === 'non-veg' ? ' · Non-Veg only' : ''}
            {search.trim() ? ` · "${search}"` : ''}
          </Text>
          <TouchableOpacity onPress={() => { setSearch(''); setFoodFilter('all'); }}>
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
            {(foodFilter !== 'all' || search) && (
              <TouchableOpacity style={styles.emptyResetBtn} onPress={() => { setSearch(''); setFoodFilter('all'); }}>
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

      {/* ── Variant Picker Modal ── */}
      <Modal visible={!!variantPickerProduct} transparent animationType="slide" onRequestClose={() => setVariantPickerProduct(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottom + 24, maxHeight: '70%' }]}>
            <View style={styles.modalHandle} />
            <View style={{ padding: Spacing.xl, paddingTop: Spacing.lg }}>
              <Text style={{ fontSize: FontSize.xl, fontWeight: '900', color: Colors.text, marginBottom: 4 }}>
                {variantPickerProduct?.name}
              </Text>
              <Text style={{ fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.lg }}>
                Choose a variant
              </Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {variantPickerProduct?.variants?.map(variant => (
                  <TouchableOpacity
                    key={variant._id}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 14, paddingHorizontal: Spacing.md,
                      borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border,
                      backgroundColor: Colors.surface, marginBottom: Spacing.sm,
                    }}
                    onPress={() => {
                      setVariantPickerProduct(null);
                      openModifiersOrAdd(variantPickerProduct, variant.price, variant._id, variant.name);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={{ flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text }}>{variant.name}</Text>
                    <Text style={{ fontSize: FontSize.md, fontWeight: '800', color: Colors.primary, marginRight: Spacing.md }}>
                      {(settings.currencySymbol || '₹')}{variant.price.toFixed(0)}
                    </Text>
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                      <MaterialIcons name="add" size={16} color={Colors.white} />
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={{ marginTop: Spacing.md, paddingVertical: 14, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' }}
                onPress={() => setVariantPickerProduct(null)}
              >
                <Text style={{ color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modifier Picker Modal ── */}
      <Modal visible={!!modifierPicker} transparent animationType="slide" onRequestClose={() => setModifierPicker(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottom + 24, maxHeight: '85%' }]}>
            <View style={styles.modalHandle} />
            {modifierPicker && (() => {
              const mgs: ModifierGroup[] = (modifierPicker.product.modifierGroups || []).filter((g: ModifierGroup) => g.isActive);
              const modTotal = mgs.reduce((s, group) => {
                return s + (modSelections[group._id] || []).reduce((gs, optId) => {
                  const opt = group.options.find(o => o._id === optId);
                  return gs + (opt?.price || 0);
                }, 0);
              }, 0);
              return (
                <View style={{ padding: Spacing.xl, paddingTop: Spacing.lg, flex: 1 }}>
                  <Text style={{ fontSize: FontSize.xl, fontWeight: '900', color: Colors.text }}>{modifierPicker.product.name}</Text>
                  <Text style={{ fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary, marginBottom: Spacing.lg }}>
                    {cur}{(modifierPicker.effectivePrice + modTotal).toFixed(0)}
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
                    {mgs.map(group => (
                      <View key={group._id} style={{ marginBottom: Spacing.xl }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                          <Text style={{ fontSize: FontSize.md, fontWeight: '700', color: Colors.text, flex: 1 }}>{group.name}</Text>
                          <View style={{ backgroundColor: group.isRequired ? Colors.danger + '18' : Colors.textMuted + '18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ fontSize: 10, color: group.isRequired ? Colors.danger : Colors.textMuted, fontWeight: '600' }}>
                              {group.isRequired ? 'REQUIRED' : 'OPTIONAL'}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ fontSize: 12, color: Colors.textMuted, marginBottom: Spacing.sm }}>
                          {group.selectionType === 'single' ? 'Choose one' : `Choose up to ${group.maxSelections}`}
                        </Text>
                        {group.options.filter(o => o.isActive).map(opt => {
                          const chosen = (modSelections[group._id] || []).includes(opt._id);
                          return (
                            <TouchableOpacity
                              key={opt._id}
                              style={{
                                flexDirection: 'row', alignItems: 'center',
                                paddingVertical: 14, paddingHorizontal: Spacing.md,
                                borderRadius: BorderRadius.lg, borderWidth: 1.5,
                                borderColor: chosen ? Colors.primary : Colors.border,
                                backgroundColor: chosen ? Colors.primary + '10' : Colors.surface,
                                marginBottom: Spacing.sm,
                              }}
                              onPress={() => {
                                setModSelections(prev => {
                                  const cur2 = prev[group._id] || [];
                                  if (group.selectionType === 'single') return { ...prev, [group._id]: chosen ? [] : [opt._id] };
                                  if (chosen) return { ...prev, [group._id]: cur2.filter(id => id !== opt._id) };
                                  if (group.maxSelections > 0 && cur2.length >= group.maxSelections) return prev;
                                  return { ...prev, [group._id]: [...cur2, opt._id] };
                                });
                              }}
                              activeOpacity={0.75}
                            >
                              <Text style={{ flex: 1, fontSize: FontSize.md, fontWeight: '700', color: chosen ? Colors.primary : Colors.text }}>{opt.name}</Text>
                              {opt.price > 0 && <Text style={{ fontSize: FontSize.md, fontWeight: '800', color: chosen ? Colors.primary : Colors.textSecondary, marginRight: Spacing.md }}>+{cur}{opt.price}</Text>}
                              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: chosen ? Colors.primary : Colors.border, alignItems: 'center', justifyContent: 'center' }}>
                                <MaterialIcons name={chosen ? 'check' : 'add'} size={16} color={Colors.white} />
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </ScrollView>
                  <TouchableOpacity
                    style={{ marginTop: Spacing.md, paddingVertical: 16, borderRadius: BorderRadius.xl, backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    onPress={validateAndConfirmModifiers}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="add-shopping-cart" size={18} color={Colors.white} />
                    <Text style={{ color: Colors.white, fontSize: FontSize.md, fontWeight: '900' }}>Add to Cart — {cur}{(modifierPicker.effectivePrice + modTotal).toFixed(0)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ marginTop: Spacing.sm, paddingVertical: 14, borderRadius: BorderRadius.xl, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' }}
                    onPress={() => setModifierPicker(null)}
                  >
                    <Text style={{ color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              );
            })()}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.textMuted, paddingHorizontal: Spacing.lg, paddingVertical: 8,
  },
  offlineBannerText: { flex: 1, color: Colors.white, fontSize: FontSize.xs, fontWeight: '600' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5', padding: Spacing.xxl },
  loadingText: { color: Colors.textSecondary, marginTop: Spacing.md, fontSize: FontSize.md },
  blockedTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginTop: Spacing.lg, textAlign: 'center' },
  blockedSub: { fontSize: FontSize.md, color: Colors.textSecondary, marginTop: Spacing.sm, textAlign: 'center', lineHeight: 22 },

  // Header — warm branded top bar
  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  headerTop: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: Spacing.md, gap: Spacing.md,
  },
  hotelName: { fontSize: FontSize.xxl + 2, fontWeight: '900', color: Colors.white, letterSpacing: 0.3 },
  hotelSub: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.75)', marginTop: 3 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.white, borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.md, paddingVertical: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: FontSize.md, color: Colors.text },

  // Food filter toggle (All / Veg / Non-Veg)
  foodFilterRow: { flexDirection: 'row', gap: 4 },
  foodFilterBtn: {
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: BorderRadius.round, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)', backgroundColor: 'rgba(255,255,255,0.15)',
  },
  foodFilterBtnActive: { backgroundColor: Colors.white, borderColor: Colors.white },
  foodFilterText: { fontSize: FontSize.xs, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  foodFilterTextActive: { color: Colors.primary },

  // Category chips — Swiggy tab style
  catBar: { backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  catBarContent: { paddingHorizontal: Spacing.md, paddingVertical: 0, gap: 4, flexDirection: 'row', alignItems: 'center' },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 0, backgroundColor: 'transparent',
    borderBottomWidth: 3, borderBottomColor: 'transparent',
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
  grid: { paddingBottom: 110, paddingTop: 6 },
  prodCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    margin: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  prodCardUnavailable: { opacity: 0.5 },
  prodImgWrap: { width: '100%', position: 'relative' },
  prodImg: { width: '100%', height: 130 },
  prodImgPlaceholder: { width: '100%', height: 130, backgroundColor: '#FFF3EE', alignItems: 'center', justifyContent: 'center' },

  vegBadge: {
    position: 'absolute', top: 8, left: 8,
    width: 18, height: 18, borderRadius: 4, borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center',
  },
  vegDot: { width: 9, height: 9, borderRadius: 5 },

  popularBadge: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: Colors.primary, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20,
  },
  popularBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '800' },

  soldOutOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  soldOutText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '900', letterSpacing: 1 },

  prodInfo: { padding: 12, paddingBottom: 10 },
  prodName: { color: '#1C1C1C', fontSize: FontSize.md, fontWeight: '800', marginBottom: 3, lineHeight: 20 },
  prodDesc: { color: '#888', fontSize: 11, marginBottom: 6, lineHeight: 15 },
  prodPrice: { color: Colors.primary, fontSize: FontSize.xl, fontWeight: '900' },

  // Add button — full width, KFC style
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    marginHorizontal: 12, marginBottom: 12, marginTop: 4,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 10,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 4,
  },
  addBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '900', letterSpacing: 0.5 },

  // Qty controls
  qtyControls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 12, marginBottom: 12, marginTop: 4,
    backgroundColor: Colors.primaryBg, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 4,
    borderWidth: 1.5, borderColor: Colors.primary + '40',
  },
  qtyBtn: { backgroundColor: Colors.primary, borderRadius: 8, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  qtyNum: { color: Colors.primary, fontSize: FontSize.xl, fontWeight: '900', minWidth: 32, textAlign: 'center' },

  // Empty state
  emptyBox: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: Colors.textMuted, fontSize: FontSize.lg, marginTop: Spacing.md, fontWeight: '700' },
  emptyResetBtn: { marginTop: Spacing.lg, backgroundColor: Colors.primaryBg, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.primary + '40' },
  emptyResetText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },

  // Floating cart — Swiggy style
  floatingCart: {
    position: 'absolute', bottom: 16, left: 16, right: 16,
    backgroundColor: Colors.primary, borderRadius: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: Spacing.lg,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 12, elevation: 10,
  },
  floatingCartLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 8,
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
  },
  itemCountText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '900' },
  floatingCartLabel: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },
  floatingCartRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  floatingCartTotal: { color: Colors.white, fontSize: FontSize.xl, fontWeight: '900' },

  // Item detail modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    overflow: 'hidden', maxHeight: '90%',
  },
  modalHandle: {
    width: 44, height: 5, borderRadius: 3, backgroundColor: '#DDD',
    alignSelf: 'center', position: 'absolute', top: 10, zIndex: 10,
  },
  modalImage: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#f5f5f5' },
  modalImagePlaceholder: { width: '100%', height: 200, backgroundColor: '#FFF3EE', alignItems: 'center', justifyContent: 'center' },
  modalBody: { padding: Spacing.xl, paddingTop: Spacing.lg },
  modalNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  modalVegBadge: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  modalName: { fontSize: FontSize.xxl, fontWeight: '900', color: '#1C1C1C', flex: 1 },
  modalTagsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md, flexWrap: 'wrap' },
  modalTag: { paddingHorizontal: Spacing.md, paddingVertical: 5, borderRadius: BorderRadius.round },
  modalTagText: { fontSize: FontSize.xs, fontWeight: '700' },
  modalDesc: { fontSize: FontSize.md, color: '#666', lineHeight: 22, marginBottom: Spacing.lg },
  priceBox: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginBottom: Spacing.lg,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  priceLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' },
  priceValue: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '700' },
  priceDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 6 },
  priceTotalLabel: { fontSize: FontSize.md, color: Colors.text, fontWeight: '800' },
  priceTotalValue: { fontSize: FontSize.xl, color: Colors.primary, fontWeight: '900' },
  modalAddBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 14,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 5,
  },
  modalAddBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900' },
  modalQtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xxl },
  modalQtyNum: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '900', minWidth: 32, textAlign: 'center' },
  modalCloseBtn: {
    position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
});

export default CustomerMenuScreen;
