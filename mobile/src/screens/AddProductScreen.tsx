import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList, Category, Ingredient, RecipeItem } from '../types';
import { showAlert } from '../utils/alert';
import { createProduct, updateProduct, getCategories, uploadImage, getIngredients } from '../services/api';
import { Colors, Spacing, FontSize, BorderRadius, API_BASE_URL } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AddProduct'>;
type AddProductRouteProp = RouteProp<RootStackParamList, 'AddProduct'>;

const AddProductScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { bottom } = useSafeAreaInsets();
  const route = useRoute<AddProductRouteProp>();
  const { settings } = useSettings();

  const editProduct = route.params?.product;
  const isEditMode = !!editProduct;

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  // Default to global tax rate for new products
  const [taxPercent, setTaxPercent] = useState(
    isEditMode ? '' : String(settings.defaultTaxPercent || 0)
  );
  const [isVeg, setIsVeg] = useState(true);
  const [shortCode, setShortCode] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [stock, setStock] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [recipe, setRecipe] = useState<RecipeItem[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientModalVisible, setIngredientModalVisible] = useState(false);
  const [pickedIngredientId, setPickedIngredientId] = useState('');
  const [pickedQty, setPickedQty] = useState('');

  useEffect(() => {
    fetchCategories();
    fetchIngredients();
  }, []);

  const fetchIngredients = async () => {
    try {
      const data = await getIngredients();
      setIngredients(data);
    } catch { /* ingredients are optional — silent fail */ }
  };

  useEffect(() => {
    if (editProduct) {
      setName(editProduct.name);
      setPrice(editProduct.price.toString());
      setTaxPercent(editProduct.taxPercent.toString());
      setIsVeg(editProduct.isVeg);
      setShortCode(editProduct.shortCode || '');
      setDescription(editProduct.description || '');
      setImageUrl(editProduct.image || '');
      setStock(editProduct.stock >= 0 ? editProduct.stock.toString() : '');
      setHsnCode(editProduct.hsnCode || '');
      setRecipe(editProduct.recipe || []);

      if (typeof editProduct.category === 'string') {
        setCategoryId(editProduct.category);
      } else {
        setCategoryId(editProduct.category._id);
        setCategoryName(editProduct.category.name);
      }
    }
  }, [editProduct]);

  useEffect(() => {
    // Resolve category name when categories load and we have an id but no name
    if (categoryId && !categoryName && categories.length > 0) {
      const found = categories.find((c) => c._id === categoryId);
      if (found) setCategoryName(found.name);
    }
  }, [categories, categoryId, categoryName]);

  const fetchCategories = async () => {
    try {
      const data = await getCategories();
      setCategories(data);
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to load categories');
    } finally {
      setLoadingCategories(false);
    }
  };

  const validate = (): boolean => {
    if (!name.trim()) {
      showAlert('Validation', 'Product name is required');
      return false;
    }
    if (!price.trim() || isNaN(Number(price)) || Number(price) <= 0) {
      showAlert('Validation', 'Enter a valid price');
      return false;
    }
    if (!categoryId) {
      showAlert('Validation', 'Please select a category');
      return false;
    }
    if (taxPercent.trim() && isNaN(Number(taxPercent))) {
      showAlert('Validation', 'Enter a valid tax percentage');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;

    setSaving(true);
    try {
      const stockValue = stock.trim() === '' ? -1 : parseInt(stock, 10);
      const productData = {
        name: name.trim(),
        price: parseFloat(price),
        category: categoryId,
        taxPercent: taxPercent.trim() ? parseFloat(taxPercent) : 0,
        isVeg,
        shortCode: shortCode.trim(),
        hsnCode: hsnCode.trim(),
        description: description.trim(),
        image: imageUrl.trim(),
        stock: isNaN(stockValue) ? -1 : stockValue,
        recipe,
      };

      if (isEditMode && editProduct) {
        await updateProduct(editProduct._id, productData);
        showAlert('Success', 'Product updated successfully', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        await createProduct(productData);
        showAlert('Success', 'Product created successfully', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const uploadAndSetImage = async (uri: string) => {
    setUploadingImage(true);
    try {
      const url = await uploadImage(uri);
      setImageUrl(url);
    } catch (error: any) {
      showAlert('Upload Failed', error.message || 'Could not upload image. Check your connection.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permission needed', 'Please allow access to your photo library to pick an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadAndSetImage(result.assets[0].uri);
    }
  };

  const handleCameraImage = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permission needed', 'Please allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadAndSetImage(result.assets[0].uri);
    }
  };

  const handleImageSource = () => {
    Alert.alert('Product Image', 'Choose image source', [
      { text: 'Camera', onPress: handleCameraImage },
      { text: 'Gallery', onPress: handlePickImage },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openIngredientPicker = () => {
    setPickedIngredientId('');
    setPickedQty('');
    setIngredientModalVisible(true);
  };

  const addRecipeRow = () => {
    if (!pickedIngredientId) { showAlert('Validation', 'Select an ingredient'); return; }
    const qty = parseFloat(pickedQty);
    if (!qty || qty <= 0) { showAlert('Validation', 'Enter a valid quantity'); return; }
    setRecipe(prev => {
      const without = prev.filter(r => r.ingredient !== pickedIngredientId);
      return [...without, { ingredient: pickedIngredientId, quantity: qty }];
    });
    setIngredientModalVisible(false);
  };

  const removeRecipeRow = (ingredientId: string) => {
    setRecipe(prev => prev.filter(r => r.ingredient !== ingredientId));
  };

  const getIngredientInfo = (id: string) => ingredients.find(i => i._id === id);

  const selectCategory = (category: Category) => {
    setCategoryId(category._id);
    setCategoryName(category.name);
    setCategoryModalVisible(false);
  };

  const renderCategoryItem = ({ item }: { item: Category }) => (
    <TouchableOpacity
      style={[
        styles.categoryItem,
        item._id === categoryId && styles.categoryItemSelected,
      ]}
      onPress={() => selectCategory(item)}
      activeOpacity={0.7}
    >
      <View style={styles.categoryItemLeft}>
        {item.icon ? (
          <Text style={styles.categoryIcon}>{item.icon}</Text>
        ) : null}
        <Text
          style={[
            styles.categoryItemText,
            item._id === categoryId && styles.categoryItemTextSelected,
          ]}
        >
          {item.name}
        </Text>
      </View>
      {item._id === categoryId && (
        <Text style={styles.checkMark}>✓</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>
          {isEditMode ? 'Edit Product' : 'Add Product'}
        </Text>

        {/* Name */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Product Name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Enter product name"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
          />
        </View>

        {/* Price */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Price (₹) *</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={setPrice}
            placeholder="0.00"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
          />
        </View>

        {/* Category */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Category *</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => setCategoryModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.inputText,
                !categoryName && { color: Colors.textMuted },
              ]}
            >
              {categoryName || 'Select a category'}
            </Text>
            <Text style={styles.dropdownArrow}>▼</Text>
          </TouchableOpacity>
        </View>

        {/* Tax Percent */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Tax %</Text>
          <TextInput
            style={styles.input}
            value={taxPercent}
            onChangeText={setTaxPercent}
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
          />
        </View>

        {/* HSN / SAC Code */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>HSN / SAC Code (GST)</Text>
          <TextInput
            style={styles.input}
            value={hsnCode}
            onChangeText={setHsnCode}
            placeholder="e.g. 996331"
            placeholderTextColor={Colors.textMuted}
            keyboardType="default"
          />
        </View>

        {/* Short Code */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Short Code</Text>
          <TextInput
            style={styles.input}
            value={shortCode}
            onChangeText={setShortCode}
            placeholder="e.g. BRG, PZA"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
          />
        </View>

        {/* Description */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Freshly cooked with spices..."
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Product Image */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Product Image</Text>
          <TouchableOpacity style={styles.imagePicker} onPress={uploadingImage ? undefined : handleImageSource} activeOpacity={0.8}>
            {uploadingImage ? (
              <View style={styles.imagePlaceholder}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.imagePlaceholderText}>Uploading...</Text>
              </View>
            ) : imageUrl ? (
              <Image
                source={{ uri: imageUrl.startsWith('/uploads/') ? `${API_BASE_URL.replace('/api', '')}${imageUrl}` : imageUrl }}
                style={styles.imagePreview}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.imagePlaceholder}>
                <MaterialIcons name="add-photo-alternate" size={40} color={Colors.textMuted} />
                <Text style={styles.imagePlaceholderText}>Tap to add photo</Text>
              </View>
            )}
          </TouchableOpacity>
          {imageUrl && !uploadingImage ? (
            <View style={styles.imageActions}>
              <TouchableOpacity style={styles.imageActionBtn} onPress={handleImageSource}>
                <MaterialIcons name="edit" size={16} color={Colors.primary} />
                <Text style={styles.imageActionText}>Change</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.imageActionBtn} onPress={() => setImageUrl('')}>
                <MaterialIcons name="delete-outline" size={16} color={Colors.danger} />
                <Text style={[styles.imageActionText, { color: Colors.danger }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* Stock */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Stock Quantity</Text>
          <TextInput
            style={styles.input}
            value={stock}
            onChangeText={setStock}
            placeholder="Leave empty for unlimited"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
          />
        </View>

        {/* Recipe (Raw Materials) */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Recipe (Raw Materials Used)</Text>
          {recipe.length > 0 && (
            <View style={{ marginBottom: Spacing.sm }}>
              {recipe.map(r => {
                const info = getIngredientInfo(r.ingredient);
                return (
                  <View key={r.ingredient} style={styles.recipeRow}>
                    <Text style={styles.recipeRowText}>
                      {info?.name || 'Unknown'} — {r.quantity} {info?.unit || ''}
                    </Text>
                    <TouchableOpacity onPress={() => removeRecipeRow(r.ingredient)} style={{ padding: 4 }}>
                      <MaterialIcons name="close" size={18} color={Colors.danger} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
          <TouchableOpacity style={styles.addRecipeBtn} onPress={openIngredientPicker} activeOpacity={0.8}>
            <MaterialIcons name="add" size={18} color={Colors.primary} />
            <Text style={styles.addRecipeBtnText}>Add Ingredient</Text>
          </TouchableOpacity>
        </View>

        {/* Veg/Non-Veg Toggle */}
        <View style={styles.fieldContainer}>
          <Text style={styles.label}>Food Type</Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelContainer}>
              <View
                style={[
                  styles.vegIndicator,
                  {
                    borderColor: isVeg ? Colors.veg : Colors.nonVeg,
                  },
                ]}
              >
                <View
                  style={[
                    styles.vegIndicatorDot,
                    {
                      backgroundColor: isVeg ? Colors.veg : Colors.nonVeg,
                    },
                  ]}
                />
              </View>
              <Text style={styles.toggleLabel}>
                {isVeg ? 'Vegetarian' : 'Non-Vegetarian'}
              </Text>
            </View>
            <Switch
              value={isVeg}
              onValueChange={setIsVeg}
              trackColor={{ false: Colors.nonVeg, true: Colors.veg }}
              thumbColor={Colors.white}
            />
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.saveButtonText}>
              {isEditMode ? 'Update Product' : 'Create Product'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Category Selection Modal */}
      <Modal
        visible={categoryModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { paddingBottom: Spacing.xxl + bottom }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Category</Text>
              <TouchableOpacity
                onPress={() => setCategoryModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {loadingCategories ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={Colors.primary} />
              </View>
            ) : categories.length === 0 ? (
              <View style={styles.modalLoading}>
                <MaterialIcons name="category" size={48} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No categories yet</Text>
                <Text style={[styles.emptyText, { fontSize: FontSize.sm, marginTop: Spacing.xs }]}>
                  Create a category first, then add products.
                </Text>
                <TouchableOpacity
                  style={styles.createCatBtn}
                  onPress={() => {
                    setCategoryModalVisible(false);
                    navigation.navigate('Categories');
                  }}
                >
                  <MaterialIcons name="category" size={18} color={Colors.white} />
                  <Text style={styles.createCatBtnText}>Manage Categories</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={categories}
                renderItem={renderCategoryItem}
                keyExtractor={(item) => item._id}
                contentContainerStyle={styles.categoryListContent}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Ingredient Picker Modal */}
      <Modal
        visible={ingredientModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIngredientModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { paddingBottom: Spacing.xxl + bottom, maxHeight: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Ingredient</Text>
              <TouchableOpacity
                onPress={() => setIngredientModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {ingredients.length === 0 ? (
              <View style={styles.modalLoading}>
                <MaterialIcons name="kitchen" size={48} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No ingredients yet</Text>
                <Text style={[styles.emptyText, { fontSize: FontSize.sm, marginTop: Spacing.xs }]}>
                  Add raw materials first from the Ingredients screen.
                </Text>
              </View>
            ) : (
              <>
                <FlatList
                  data={ingredients}
                  keyExtractor={(item) => item._id}
                  contentContainerStyle={styles.categoryListContent}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.categoryItem, item._id === pickedIngredientId && styles.categoryItemSelected]}
                      onPress={() => setPickedIngredientId(item._id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.categoryItemText, item._id === pickedIngredientId && styles.categoryItemTextSelected]}>
                        {item.name} ({item.unit})
                      </Text>
                      {item._id === pickedIngredientId && <Text style={styles.checkMark}>✓</Text>}
                    </TouchableOpacity>
                  )}
                />
                <View style={{ paddingHorizontal: Spacing.xl, paddingTop: Spacing.md }}>
                  <Text style={styles.label}>Quantity used per unit sold</Text>
                  <TextInput
                    style={styles.input}
                    value={pickedQty}
                    onChangeText={setPickedQty}
                    placeholder="e.g. 0.2 (kg)"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <TouchableOpacity style={[styles.saveButton, { marginTop: Spacing.lg }]} onPress={addRecipeRow}>
                    <Text style={styles.saveButtonText}>Add to Recipe</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingBottom: 40,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xxl,
  },
  fieldContainer: {
    marginBottom: Spacing.xl,
  },
  label: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    fontWeight: '500',
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    fontSize: FontSize.lg,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
  },
  inputText: {
    fontSize: FontSize.lg,
    color: Colors.text,
    flex: 1,
  },
  dropdownArrow: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginLeft: Spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 52,
  },
  toggleLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vegIndicator: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  vegIndicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  toggleLabel: {
    fontSize: FontSize.lg,
    color: Colors.text,
  },
  imagePicker: {
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: BorderRadius.md,
  },
  imagePlaceholder: {
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  imagePlaceholderText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
  },
  imageActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  imageActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  imageActionText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: '600',
  },
  recipeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  recipeRowText: {
    fontSize: FontSize.md,
    color: Colors.text,
    flex: 1,
  },
  addRecipeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
  },
  addRecipeBtnText: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
    minHeight: 56,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: '70%',
    paddingBottom: Spacing.xxl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  modalClose: {
    fontSize: FontSize.xl,
    color: Colors.textSecondary,
  },
  modalLoading: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  createCatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.lg,
  },
  createCatBtnText: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  categoryListContent: {
    paddingVertical: Spacing.sm,
  },
  categoryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  categoryItemSelected: {
    backgroundColor: Colors.card,
  },
  categoryItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryIcon: {
    fontSize: FontSize.xl,
    marginRight: Spacing.md,
  },
  categoryItemText: {
    fontSize: FontSize.lg,
    color: Colors.text,
  },
  categoryItemTextSelected: {
    color: Colors.primary,
    fontWeight: '700',
  },
  checkMark: {
    fontSize: FontSize.xl,
    color: Colors.primary,
    fontWeight: '700',
  },
});

export default AddProductScreen;
