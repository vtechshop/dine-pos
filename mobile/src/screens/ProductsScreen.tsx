import React, { useState, useEffect, useCallback } from 'react';
import { showAlert } from '../utils/alert';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList, Product, Category } from '../types';
import { MaterialIcons } from '@expo/vector-icons';
import { getProducts, getCategories, deleteProduct, updateProduct } from '../services/api';
import { Colors, Spacing, FontSize, BorderRadius } from '../utils/constants';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const ProductsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { bottom } = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const numColumns = screenWidth > 600 ? 3 : 2;

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stock modal
  const [stockModalVisible, setStockModalVisible] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [stockInput, setStockInput] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [productsData, categoriesData] = await Promise.all([
        getProducts(),
        getCategories(),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleDeleteProduct = (product: Product) => {
    showAlert(
      'Delete Product',
      `Are you sure you want to delete "${product.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProduct(product._id);
              setProducts((prev) => prev.filter((p) => p._id !== product._id));
            } catch (error: any) {
              showAlert('Error', error.message || 'Failed to delete product');
            }
          },
        },
      ]
    );
  };

  const handleToggleStock = async (product: Product) => {
    try {
      await updateProduct(product._id, {
        isAvailable: !product.isAvailable,
      });
      setProducts((prev) =>
        prev.map((p) =>
          p._id === product._id ? { ...p, isAvailable: !p.isAvailable } : p
        )
      );
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to update stock status');
    }
  };

  const openStockModal = (product: Product) => {
    setStockProduct(product);
    setStockInput(product.stock >= 0 ? product.stock.toString() : '');
    setStockModalVisible(true);
  };

  const handleSaveStock = async () => {
    if (!stockProduct) return;
    const stockValue = stockInput.trim() === '' ? -1 : parseInt(stockInput, 10);
    if (stockInput.trim() !== '' && (isNaN(stockValue) || stockValue < 0)) {
      showAlert('Error', 'Enter a valid stock number (or leave empty for unlimited)');
      return;
    }
    try {
      const isAvailable = stockValue === -1 || stockValue > 0;
      await updateProduct(stockProduct._id, { stock: stockValue, isAvailable });
      setProducts((prev) =>
        prev.map((p) =>
          p._id === stockProduct._id ? { ...p, stock: stockValue, isAvailable } : p
        )
      );
      setStockModalVisible(false);
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to update stock');
    }
  };

  const handleEditProduct = (product: Product) => {
    navigation.navigate('AddProduct', { product });
  };

  const handleAddProduct = () => {
    navigation.navigate('AddProduct', {});
  };

  const getCategoryName = (category: Category | string): string => {
    if (typeof category === 'string') {
      const found = categories.find((c) => c._id === category);
      return found ? found.name : 'Unknown';
    }
    return category.name;
  };

  const getCategoryId = (category: Category | string): string => {
    if (typeof category === 'string') return category;
    return category._id;
  };

  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      !selectedCategory || getCategoryId(product.category) === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.shortCode?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const getStockLabel = (product: Product): string => {
    if (product.stock === undefined || product.stock === -1) return 'Unlimited';
    if (product.stock === 0) return 'Out of Stock';
    return `${product.stock} left`;
  };

  const getStockColor = (product: Product): string => {
    if (product.stock === undefined || product.stock === -1) return Colors.success;
    if (product.stock === 0) return Colors.danger;
    if (product.stock <= 5) return Colors.warning;
    return Colors.success;
  };

  const renderCategoryChip = ({ item }: { item: Category | { _id: null; name: string } }) => {
    const isSelected = item._id === selectedCategory;
    return (
      <TouchableOpacity
        style={[styles.categoryChip, isSelected && styles.categoryChipSelected]}
        onPress={() =>
          setSelectedCategory(item._id === selectedCategory ? null : item._id)
        }
        activeOpacity={0.7}
      >
        {'icon' in item && item.icon ? (
          <Text style={{ fontSize: 13 }}>{item.icon}</Text>
        ) : null}
        <Text
          style={[
            styles.categoryChipText,
            isSelected && styles.categoryChipTextSelected,
          ]}
        >
          {item.name}
        </Text>
      </TouchableOpacity>
    );
  };

  const cardWidth = `${Math.floor(100 / numColumns) - 2}%` as any;

  const renderProductCard = ({ item }: { item: Product }) => (
    <TouchableOpacity
      style={[styles.productCard, { width: cardWidth }]}
      onPress={() => handleEditProduct(item)}
      onLongPress={() => handleDeleteProduct(item)}
      activeOpacity={0.7}
    >
      <View style={styles.productCardHeader}>
        <View
          style={[
            styles.vegBadge,
            { borderColor: item.isVeg ? Colors.veg : Colors.nonVeg },
          ]}
        >
          <View
            style={[
              styles.vegDot,
              { backgroundColor: item.isVeg ? Colors.veg : Colors.nonVeg },
            ]}
          />
        </View>
        <TouchableOpacity
          onPress={() => handleDeleteProduct(item)}
          style={styles.deleteButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.deleteButtonText}>x</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.productName} numberOfLines={2}>
        {item.name}
      </Text>

      {item.shortCode ? (
        <Text style={styles.shortCode}>{item.shortCode}</Text>
      ) : null}

      <Text style={styles.categoryLabel}>{getCategoryName(item.category)}</Text>

      <View style={styles.productCardFooter}>
        <Text style={styles.productPrice}>₹{item.price.toFixed(2)}</Text>
        {item.taxPercent > 0 && (
          <Text style={styles.taxBadge}>{item.taxPercent}% tax</Text>
        )}
      </View>

      {/* Stock Info & Edit */}
      <TouchableOpacity
        style={[styles.stockRow, { borderColor: getStockColor(item) + '40' }]}
        onPress={() => openStockModal(item)}
        activeOpacity={0.7}
      >
        <View style={styles.stockInfo}>
          <MaterialIcons name="inventory" size={14} color={getStockColor(item)} />
          <Text style={[styles.stockLabel, { color: getStockColor(item) }]}>
            {getStockLabel(item)}
          </Text>
        </View>
        <MaterialIcons name="edit" size={14} color={Colors.textSecondary} />
      </TouchableOpacity>

      {/* Stock Toggle */}
      <TouchableOpacity
        style={[
          styles.stockToggle,
          { backgroundColor: item.isAvailable ? Colors.success : Colors.danger },
        ]}
        onPress={() => handleToggleStock(item)}
        activeOpacity={0.7}
      >
        <MaterialIcons
          name={item.isAvailable ? 'check-circle' : 'cancel'}
          size={14}
          color={Colors.white}
        />
        <Text style={styles.stockToggleText}>
          {item.isAvailable ? 'In Stock' : 'Out of Stock'}
        </Text>
      </TouchableOpacity>

      {!item.isAvailable && (
        <View style={styles.unavailableOverlay}>
          <Text style={styles.unavailableText}>Out of Stock</Text>
          <TouchableOpacity
            style={styles.markAvailableBtn}
            onPress={() => handleToggleStock(item)}
          >
            <Text style={styles.markAvailableText}>Mark Available</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading products...</Text>
      </View>
    );
  }

  const allChipData: Array<Category | { _id: null; name: string }> = [
    { _id: null, name: 'All' } as any,
    ...categories,
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 8 }}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Menu Items</Text>
          <Text style={styles.headerSub}>{products.length} product{products.length !== 1 ? 's' : ''}</Text>
        </View>
        <TouchableOpacity
          style={styles.catManageBtn}
          onPress={() => navigation.navigate('Categories')}
          activeOpacity={0.8}
        >
          <MaterialIcons name="category" size={16} color={Colors.primary} />
          <Text style={styles.catManageBtnText}>Categories ({categories.length})</Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <MaterialIcons name="search" size={20} color={Colors.textMuted} style={{ marginRight: Spacing.sm }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          placeholderTextColor={Colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity style={styles.clearSearch} onPress={() => setSearchQuery('')}>
            <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Category Chips */}
      <FlatList
        data={allChipData}
        renderItem={renderCategoryChip}
        keyExtractor={(item) => item._id ?? 'all'}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryList}
        style={styles.categoryListContainer}
      />

      {/* Products Grid */}
      {filteredProducts.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No products found</Text>
          <Text style={styles.emptySubText}>
            {searchQuery
              ? 'Try a different search term'
              : 'Tap + to add your first product'}
          </Text>
        </View>
      ) : (
        <FlatList
          key={numColumns}
          data={filteredProducts}
          renderItem={renderProductCard}
          keyExtractor={(item) => item._id}
          numColumns={numColumns}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.productList}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: Spacing.xxl + bottom }]}
        onPress={handleAddProduct}
        activeOpacity={0.8}
      >
        <MaterialIcons name="add" size={22} color={Colors.white} />
        <Text style={styles.fabText}>Add Product</Text>
      </TouchableOpacity>

      {/* Stock Edit Modal */}
      <Modal
        visible={stockModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setStockModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Update Stock</Text>
            {stockProduct && (
              <Text style={styles.modalProductName}>{stockProduct.name}</Text>
            )}
            <Text style={styles.modalHint}>
              Enter stock quantity (leave empty for unlimited)
            </Text>
            <TextInput
              style={styles.modalInput}
              value={stockInput}
              onChangeText={setStockInput}
              placeholder="e.g. 50 (empty = unlimited)"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setStockModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveStock}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl, paddingBottom: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800', letterSpacing: -0.5 },
  headerSub: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: 2 },
  catManageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary + '18', borderWidth: 1, borderColor: Colors.primary + '50',
    borderRadius: BorderRadius.round, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  catManageBtnText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    marginTop: Spacing.md,
  },
  emptyText: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '600',
  },
  emptySubText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    marginTop: Spacing.sm,
  },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  clearSearch: {
    padding: Spacing.xs,
  },
  clearSearchText: {
    color: Colors.textSecondary,
    fontSize: FontSize.lg,
  },
  categoryListContainer: {
    maxHeight: 50,
    minHeight: 50,
  },
  categoryList: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    alignItems: 'center',
  },
  categoryChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 6,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  categoryChipText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  categoryChipTextSelected: {
    color: Colors.white,
    fontWeight: '700',
  },
  productList: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  productCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    position: 'relative',
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#8B3A1A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 4,
  },
  productCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  vegBadge: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  vegDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  deleteButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButtonText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
  productName: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  shortCode: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    marginBottom: Spacing.xs,
    fontFamily: 'monospace',
  },
  categoryLabel: {
    color: Colors.primary,
    fontSize: FontSize.xs,
    fontWeight: '500',
    marginBottom: Spacing.sm,
  },
  productCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productPrice: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  taxBadge: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
  },

  // Stock row
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    backgroundColor: Colors.surface,
  },
  stockInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stockLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },

  stockToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.sm,
    gap: 4,
  },
  stockToggleText: {
    color: Colors.white,
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  markAvailableBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.success,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  markAvailableText: {
    color: Colors.white,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  unavailableOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
  },
  unavailableText: {
    color: Colors.danger,
    fontSize: FontSize.md,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  fab: {
    position: 'absolute',
    bottom: Spacing.xxl,
    right: Spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.primary,
    elevation: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  fabText: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: '700',
  },

  // Stock Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  modalContainer: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  modalProductName: {
    fontSize: FontSize.md,
    color: Colors.primary,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  modalHint: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  modalInput: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    fontSize: FontSize.xl,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  modalCancelText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  modalSaveText: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
});

export default ProductsScreen;
