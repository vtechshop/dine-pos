import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Image, StatusBar, Alert, Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '../../utils/constants';
import { applyCloudinaryTransform } from '../../utils/cloudinary';
import { getProducts, getCategories, uploadImage, updateProduct } from '../../services/api';
import type { Product, Category } from '../../types';

type PhotoSource = 'gallery' | 'camera';

const BulkImageAssignScreen: React.FC = () => {
  const navigation = useNavigation();
  const { bottom } = useSafeAreaInsets();

  const [loading, setLoading]         = useState(true);
  const [unassigned, setUnassigned]   = useState<Product[]>([]);
  const [withImages, setWithImages]   = useState<Product[]>([]);
  const [categories, setCategories]   = useState<Category[]>([]);

  const [uriQueue, setUriQueue]       = useState<string[]>([]);
  const [photoSource, setPhotoSource] = useState<PhotoSource>('gallery');
  const [currentIdx, setCurrentIdx]   = useState(0);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [assignedCount, setAssignedCount] = useState(0);
  const [skippedCount, setSkippedCount]   = useState(0);
  const [done, setDone] = useState(false);

  // Long-press copy modal
  const [copyModalVisible, setCopyModalVisible]   = useState(false);
  const [copyTargetId, setCopyTargetId]           = useState<string | null>(null);
  const [copyingId, setCopyingId]                 = useState<string | null>(null);

  // Variant suggestion modal
  const [variantModalVisible, setVariantModalVisible] = useState(false);
  const [variantTarget, setVariantTarget]             = useState<{ url: string; variants: Product[] } | null>(null);
  const [applyingVariants, setApplyingVariants]       = useState(false);

  const assigningRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [prods, cats] = await Promise.all([getProducts(), getCategories()]);
        setUnassigned(prods.filter((p: Product) => !p.image));
        setWithImages(prods.filter((p: Product) => !!p.image && p.imageStatus !== 'placeholder'));
        setCategories(cats);
      } catch { /* screen still usable */ }
      setLoading(false);
    })();
  }, []);

  const getCategoryName = (cat: Category | string): string => {
    if (typeof cat === 'string') return categories.find(c => c._id === cat)?.name ?? '';
    return cat.name;
  };

  // Detect products with same base name as the newly assigned product
  const findVariants = (assigned: Product): Product[] => {
    const normalize = (s: string) =>
      s.toLowerCase()
        .replace(/\b(half|full|family|regular|large|small|medium|mini|xl|xs|party|jumbo|single|double|triple)\b/g, '')
        .replace(/[^a-z0-9 ]/g, '')
        .trim();
    const baseParts = normalize(assigned.name).split(/\s+/).filter(Boolean).slice(0, 2);
    const base = baseParts.join(' ');
    if (base.length < 4) return [];
    return unassigned.filter(p =>
      p._id !== assigned._id && normalize(p.name).includes(base)
    );
  };

  const pickPhotos = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: 60,
    });
    if (result.canceled || !result.assets.length) return;
    setPhotoSource('gallery');
    setUriQueue(result.assets.map(a => a.uri));
    setCurrentIdx(0);
    setAssignedCount(0);
    setSkippedCount(0);
    setDone(false);
  };

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets.length) return;
    setPhotoSource('camera');
    setUriQueue([result.assets[0].uri]);
    setCurrentIdx(0);
    setAssignedCount(0);
    setSkippedCount(0);
    setDone(false);
  };

  const assignPhoto = async (product: Product) => {
    if (assigningRef.current) return;
    assigningRef.current = true;
    setUploadingId(product._id);
    try {
      const url = await uploadImage(uriQueue[currentIdx]);
      await updateProduct(product._id, { image: url, imageSource: photoSource, imageStatus: 'real' });
      setUnassigned(prev => prev.filter(p => p._id !== product._id));
      setWithImages(prev => [...prev, { ...product, image: url, imageSource: photoSource, imageStatus: 'real' }]);
      setAssignedCount(c => c + 1);

      const variants = findVariants(product);
      if (variants.length > 0) {
        setVariantTarget({ url, variants });
        setVariantModalVisible(true);
        // advance() called after variant modal closes
      } else {
        advance();
      }
    } catch (e: any) {
      Alert.alert('Upload failed', e.message || 'Could not upload. Try again.');
      advance();
    } finally {
      setUploadingId(null);
      assigningRef.current = false;
    }
  };

  const advance = () => {
    const next = currentIdx + 1;
    if (next >= uriQueue.length) setDone(true);
    else setCurrentIdx(next);
  };

  const skipPhoto = () => {
    setSkippedCount(c => c + 1);
    advance();
  };

  // ── Long-press copy handlers ──────────────────────────────────────────────────

  const openCopyModal = (product: Product) => {
    if (assigningRef.current) return;
    setCopyTargetId(product._id);
    setCopyModalVisible(true);
  };

  const copyImageFromProduct = async (sourceProduct: Product) => {
    if (!copyTargetId || copyingId) return;
    setCopyingId(sourceProduct._id);
    try {
      await updateProduct(copyTargetId, {
        image: sourceProduct.image,
        imageSource: 'copy',
        imageStatus: 'real',
      });
      setUnassigned(prev => prev.filter(p => p._id !== copyTargetId));
      setAssignedCount(c => c + 1);
      setCopyModalVisible(false);
      setCopyTargetId(null);
    } catch (e: any) {
      Alert.alert('Failed', e.message || 'Could not copy image.');
    } finally {
      setCopyingId(null);
    }
  };

  // ── Variant apply handlers ────────────────────────────────────────────────────

  const applyToVariants = async () => {
    if (!variantTarget || applyingVariants) return;
    setApplyingVariants(true);
    try {
      await Promise.all(
        variantTarget.variants.map(v =>
          updateProduct(v._id, { image: variantTarget.url, imageSource: photoSource, imageStatus: 'real' })
        )
      );
      const variantIds = new Set(variantTarget.variants.map(v => v._id));
      setUnassigned(prev => prev.filter(p => !variantIds.has(p._id)));
      setAssignedCount(c => c + variantTarget.variants.length);
    } catch { /* best-effort */ }
    setApplyingVariants(false);
    setVariantModalVisible(false);
    setVariantTarget(null);
    advance();
  };

  const skipVariants = () => {
    setVariantModalVisible(false);
    setVariantTarget(null);
    advance();
  };

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────────

  if (done) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Bulk Image Assignment</Text>
        </View>
        <View style={[styles.centered, { paddingBottom: bottom + Spacing.xl }]}>
          <MaterialIcons name="check-circle" size={64} color={Colors.success} />
          <Text style={styles.doneTitle}>Done!</Text>
          <Text style={styles.doneSub}>
            {assignedCount} product{assignedCount !== 1 ? 's' : ''} assigned
          </Text>
          {skippedCount > 0 && (
            <Text style={styles.doneNote}>{skippedCount} photo{skippedCount !== 1 ? 's' : ''} skipped</Text>
          )}
          {unassigned.length > 0 && (
            <Text style={styles.doneWarning}>
              {unassigned.length} product{unassigned.length !== 1 ? 's' : ''} still need images
            </Text>
          )}
          <TouchableOpacity style={[styles.primaryBtn, { marginTop: Spacing.xl }]} onPress={pickPhotos} activeOpacity={0.8}>
            <MaterialIcons name="add-photo-alternate" size={20} color={Colors.white} />
            <Text style={styles.primaryBtnText}>Add More Photos</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.ghostBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Prompt: no photos picked yet ─────────────────────────────────────────────

  if (uriQueue.length === 0) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Bulk Image Assignment</Text>
        </View>
        <View style={[styles.centered, { paddingBottom: bottom + Spacing.xl }]}>
          <MaterialIcons name="add-photo-alternate" size={64} color={Colors.primary + '55'} />
          <Text style={styles.promptTitle}>
            {unassigned.length} product{unassigned.length !== 1 ? 's' : ''} need images
          </Text>
          <Text style={styles.promptSub}>
            Select photos from your gallery or take a photo.{'\n'}You'll assign each photo to a product.
          </Text>
          {unassigned.length === 0 ? (
            <>
              <MaterialIcons name="check-circle" size={40} color={Colors.success} style={{ marginTop: Spacing.xl }} />
              <Text style={styles.doneSub}>All products already have images!</Text>
              <TouchableOpacity style={styles.ghostBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
                <Text style={styles.ghostBtnText}>Go Back</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={[styles.primaryBtn, { marginTop: Spacing.xl }]} onPress={pickPhotos} activeOpacity={0.8}>
                <MaterialIcons name="photo-library" size={20} color={Colors.white} />
                <Text style={styles.primaryBtnText}>Select from Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, { marginTop: Spacing.sm }]} onPress={pickFromCamera} activeOpacity={0.8}>
                <MaterialIcons name="camera-alt" size={20} color={Colors.primary} />
                <Text style={styles.secondaryBtnText}>Take a Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghostBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
                <Text style={styles.ghostBtnText}>Skip for now</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  // ── Main assignment view ──────────────────────────────────────────────────────

  const remaining = uriQueue.length - currentIdx;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Assign Image</Text>
          <Text style={styles.headerSub}>Photo {currentIdx + 1} of {uriQueue.length}</Text>
        </View>
        <TouchableOpacity onPress={skipPhoto} style={styles.skipBtn} disabled={!!uploadingId}>
          <Text style={[styles.skipBtnText, !!uploadingId && { opacity: 0.4 }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Current photo */}
      <View style={styles.photoBox}>
        <Image source={{ uri: uriQueue[currentIdx] }} style={styles.photoImg} resizeMode="cover" />
        <View style={styles.photoBadge}>
          <Text style={styles.photoBadgeText}>{remaining} left</Text>
        </View>
      </View>

      <Text style={styles.instruction}>Tap to assign · Long-press to copy existing image</Text>

      <FlatList
        data={unassigned}
        keyExtractor={item => item._id}
        contentContainerStyle={{ paddingBottom: bottom + Spacing.md, paddingTop: Spacing.xs }}
        renderItem={({ item }) => {
          const isUploading = uploadingId === item._id;
          return (
            <TouchableOpacity
              style={[styles.productRow, isUploading && styles.productRowActive]}
              onPress={() => assignPhoto(item)}
              onLongPress={() => openCopyModal(item)}
              delayLongPress={400}
              disabled={!!uploadingId}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.productCat} numberOfLines={1}>{getCategoryName(item.category)}</Text>
              </View>
              {isUploading
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <MaterialIcons name="add-photo-alternate" size={22} color={Colors.primary} />
              }
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={[styles.centered, { flex: 0, paddingVertical: Spacing.xl }]}>
            <MaterialIcons name="check-circle" size={40} color={Colors.success} />
            <Text style={styles.doneSub}>All products have images!</Text>
          </View>
        }
      />

      {/* ── Long-press copy modal ────────────────────────────────────────────── */}
      <Modal
        visible={copyModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { setCopyModalVisible(false); setCopyTargetId(null); }}
      >
        <TouchableWithoutFeedback onPress={() => { setCopyModalVisible(false); setCopyTargetId(null); }}>
          <View style={styles.modalOverlay} />
        </TouchableWithoutFeedback>
        <View style={[styles.modalSheet, { paddingBottom: bottom + Spacing.md }]}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Use Existing Image</Text>
          <Text style={styles.modalSub}>Pick a product image to copy</Text>
          {withImages.length === 0 ? (
            <View style={[styles.centered, { flex: 0, paddingVertical: Spacing.xl }]}>
              <Text style={styles.doneSub}>No products have images yet.</Text>
            </View>
          ) : (
            <FlatList
              data={withImages}
              keyExtractor={item => item._id}
              style={{ maxHeight: 360 }}
              renderItem={({ item }) => {
                const thumbUri = applyCloudinaryTransform(item.image, 100, 100);
                const isCopying = copyingId === item._id;
                return (
                  <TouchableOpacity
                    style={styles.copyRow}
                    onPress={() => copyImageFromProduct(item)}
                    disabled={!!copyingId}
                    activeOpacity={0.7}
                  >
                    {thumbUri
                      ? <Image source={{ uri: thumbUri }} style={styles.copyThumb} resizeMode="cover" />
                      : <View style={[styles.copyThumb, { backgroundColor: Colors.border, justifyContent: 'center', alignItems: 'center' }]}>
                          <MaterialIcons name="image" size={20} color={Colors.textMuted} />
                        </View>
                    }
                    <View style={{ flex: 1, marginLeft: Spacing.md }}>
                      <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.productCat} numberOfLines={1}>{getCategoryName(item.category)}</Text>
                    </View>
                    {isCopying
                      ? <ActivityIndicator size="small" color={Colors.primary} />
                      : <MaterialIcons name="content-copy" size={18} color={Colors.primary} />
                    }
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </Modal>

      {/* ── Variant suggestion modal ─────────────────────────────────────────── */}
      <Modal
        visible={variantModalVisible}
        transparent
        animationType="fade"
        onRequestClose={skipVariants}
      >
        <View style={styles.variantOverlay}>
          <View style={styles.variantSheet}>
            <MaterialIcons name="auto-fix-high" size={32} color={Colors.primary} style={{ marginBottom: Spacing.sm }} />
            <Text style={styles.variantTitle}>Apply to similar products?</Text>
            {variantTarget?.variants.map(v => (
              <Text key={v._id} style={styles.variantItem} numberOfLines={1}>• {v.name}</Text>
            ))}
            <View style={styles.variantBtns}>
              <TouchableOpacity style={styles.variantSkipBtn} onPress={skipVariants} disabled={applyingVariants}>
                <Text style={styles.variantSkipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.variantApplyBtn} onPress={applyToVariants} disabled={applyingVariants} activeOpacity={0.8}>
                {applyingVariants
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.variantApplyText}>Apply to All</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn:    { padding: 4, marginRight: Spacing.sm },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  headerSub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  skipBtn:    { paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  skipBtnText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },

  photoBox:  { height: 200, backgroundColor: Colors.border, position: 'relative' },
  photoImg:  { width: '100%', height: '100%' },
  photoBadge: {
    position: 'absolute', bottom: Spacing.sm, right: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  photoBadgeText: { color: '#fff', fontSize: FontSize.xs, fontWeight: '600' },

  instruction: {
    fontSize: FontSize.xs, color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },

  productRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.md, marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  productRowActive: { borderColor: Colors.primary },
  productName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  productCat:  { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },

  promptTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg, textAlign: 'center' },
  promptSub:   { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm, textAlign: 'center', lineHeight: 20 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg, gap: Spacing.sm,
  },
  primaryBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.primary,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg, gap: Spacing.sm,
  },
  secondaryBtnText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },

  ghostBtn:    { marginTop: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  ghostBtnText: { fontSize: FontSize.sm, color: Colors.textSecondary },

  doneTitle:   { fontSize: 28, fontWeight: '800', color: Colors.text, marginTop: Spacing.md },
  doneSub:     { fontSize: FontSize.md, color: Colors.textSecondary, marginTop: Spacing.sm },
  doneNote:    { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },
  doneWarning: { fontSize: FontSize.sm, color: Colors.warning, marginTop: 4 },

  // Copy modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.md,
  },
  modalTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  modalSub:   { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  copyRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  copyThumb: { width: 52, height: 52, borderRadius: BorderRadius.sm },

  // Variant modal
  variantOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  variantSheet: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    width: '100%',
    alignItems: 'center',
  },
  variantTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: Spacing.sm },
  variantItem:  { fontSize: FontSize.sm, color: Colors.textSecondary, alignSelf: 'flex-start', marginTop: 2 },
  variantBtns:  { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  variantSkipBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center',
  },
  variantSkipText: { fontSize: FontSize.md, color: Colors.textSecondary },
  variantApplyBtn: {
    flex: 2,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  variantApplyText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.white },
});

export default BulkImageAssignScreen;
