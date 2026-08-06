import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Switch,
  Alert,
  StatusBar,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '../../utils/constants';
import {
  extractMenuFromFile,
  checkMenuDuplicates,
  importExtractedMenu,
  AIExtractedCategory,
  AIImportCategory,
  AIImportProduct,
  AIMenuImportResults,
} from '../../services/api';

type Step = 'pick' | 'processing' | 'review' | 'result';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const AIMenuImportScreen: React.FC = () => {
  const navigation = useNavigation<NavProp>();
  const { bottom } = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('pick');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [extractedCategories, setExtractedCategories] = useState<AIImportCategory[]>([]);
  const [restaurantName, setRestaurantName] = useState('');
  const [duplicates, setDuplicates] = useState<Array<{ productName: string; categoryName: string }>>([]);
  const [importResults, setImportResults] = useState<AIMenuImportResults | null>(null);

  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const importingRef = useRef(false);

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const filename = asset.uri.split('/').pop() || 'menu.jpg';
    const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    await runExtraction(asset.uri, mimeType, filename);
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const filename = `menu_photo_${Date.now()}.jpg`;
    await runExtraction(asset.uri, 'image/jpeg', filename);
  };

  const handlePickPDF = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      await runExtraction(asset.uri, 'application/pdf', asset.name || 'menu.pdf');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to pick PDF.');
    }
  };

  const runExtraction = async (uri: string, mimeType: string, filename: string) => {
    setError(null);
    setStep('processing');
    setProcessing(true);
    try {
      const result = await extractMenuFromFile(uri, mimeType, filename);
      setRestaurantName(result.restaurantName || '');

      // Seed duplicateAction: default 'skip' for all
      const importCats: AIImportCategory[] = result.categories.map(cat => ({
        name: cat.name,
        products: cat.products.map(p => ({ ...p, duplicateAction: 'skip' as const })),
      }));
      setExtractedCategories(importCats);

      // Check for duplicates
      const dupResult = await checkMenuDuplicates(result.categories);
      setDuplicates(dupResult.duplicates);

      setStep('review');
    } catch (e: any) {
      setError(e.message || 'Extraction failed. Please try again.');
      setStep('pick');
    } finally {
      setProcessing(false);
    }
  };

  const toggleProductEnabled = (catIdx: number, prodIdx: number) => {
    setExtractedCategories(prev => {
      const updated = prev.map((c, ci) => {
        if (ci !== catIdx) return c;
        return {
          ...c,
          products: c.products.map((p, pi) => {
            if (pi !== prodIdx) return p;
            // Toggle: if duplicateAction is 'skip' and it IS a duplicate, cycle skip→overwrite→copy
            // For regular products without duplicates, just remove/add by setting price to null as sentinel
            // We use a special field: enabled (not in type, so we'll use confidence as a proxy)
            // Actually, the cleaner approach: use duplicateAction undefined = "include", 'skip' = "exclude" for non-dups
            // But the API uses duplicateAction only for duplicates. For non-duplicates we can just omit.
            // Let's use a local "enabled" approach by toggling confidence to -1 as a marker
            return { ...p, confidence: p.confidence === -1 ? Math.max(0, p.confidence) : -1 };
          }),
        };
      });
      return updated;
    });
  };

  const setDuplicateAction = (catName: string, prodName: string, action: 'skip' | 'overwrite' | 'copy') => {
    setExtractedCategories(prev =>
      prev.map(c => {
        if (c.name !== catName) return c;
        return {
          ...c,
          products: c.products.map(p => {
            if (p.name !== prodName) return p;
            return { ...p, duplicateAction: action };
          }),
        };
      })
    );
  };

  const updateProductPrice = (catIdx: number, prodIdx: number, val: string) => {
    const parsed = parseFloat(val);
    setExtractedCategories(prev =>
      prev.map((c, ci) => {
        if (ci !== catIdx) return c;
        return {
          ...c,
          products: c.products.map((p, pi) => {
            if (pi !== prodIdx) return p;
            return { ...p, price: isNaN(parsed) ? null : parsed };
          }),
        };
      })
    );
  };

  const isDuplicate = (catName: string, prodName: string): boolean =>
    duplicates.some(d => d.categoryName === catName && d.productName === prodName);

  const handleImport = async () => {
    if (importingRef.current) return;

    const toImport: AIImportCategory[] = extractedCategories
      .map(cat => ({
        ...cat,
        products: cat.products.filter(p => p.confidence !== -1),
      }))
      .filter(cat => cat.products.length > 0);

    if (toImport.length === 0) {
      Alert.alert('Nothing to import', 'No products selected for import.');
      return;
    }

    importingRef.current = true;
    setProcessing(true);
    try {
      const res = await importExtractedMenu(toImport);
      setImportResults(res.results);
      setStep('result');
    } catch (e: any) {
      Alert.alert('Import failed', e.message || 'Could not import menu. Please try again.');
    } finally {
      importingRef.current = false;
      setProcessing(false);
    }
  };

  const totalProducts = extractedCategories.reduce((sum, c) => sum + c.products.length, 0);
  const selectedProducts = extractedCategories.reduce(
    (sum, c) => sum + c.products.filter(p => p.confidence !== -1).length,
    0,
  );

  // ── STEP: PICK ─────────────────────────────────────────────────────────────
  if (step === 'pick') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>AI Menu Import</Text>
        </View>

        <ScrollView contentContainerStyle={styles.pickContent}>
          <View style={styles.heroIcon}>
            <MaterialIcons name="auto-awesome" size={48} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Import Menu with AI</Text>
          <Text style={styles.heroSubtitle}>
            Upload a photo or PDF of your menu. Gemini AI will extract all categories and items automatically.
          </Text>

          {error ? (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={18} color={Colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.pickOptions}>
            <TouchableOpacity style={styles.pickCard} onPress={handlePickImage} activeOpacity={0.8}>
              <MaterialIcons name="photo-library" size={32} color={Colors.primary} />
              <Text style={styles.pickCardTitle}>Gallery Image</Text>
              <Text style={styles.pickCardSub}>JPG, PNG, WEBP</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pickCard} onPress={handleTakePhoto} activeOpacity={0.8}>
              <MaterialIcons name="camera-alt" size={32} color='#059669' />
              <Text style={styles.pickCardTitle}>Take Photo</Text>
              <Text style={styles.pickCardSub}>Use camera</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.pickCard} onPress={handlePickPDF} activeOpacity={0.8}>
              <MaterialIcons name="picture-as-pdf" size={32} color='#DC2626' />
              <Text style={styles.pickCardTitle}>PDF Menu</Text>
              <Text style={styles.pickCardSub}>Scanned or digital</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tipBox}>
            <MaterialIcons name="lightbulb-outline" size={16} color={Colors.warning} />
            <Text style={styles.tipText}>
              Best results with clear, well-lit photos. For PDFs, digital text works better than scanned images.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ── STEP: PROCESSING ───────────────────────────────────────────────────────
  if (step === 'processing') {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.processingTitle}>Analyzing your menu...</Text>
        <Text style={styles.processingSubtitle}>
          Gemini AI is reading and extracting all items.{'\n'}This may take up to 2 minutes.
        </Text>
      </View>
    );
  }

  // ── STEP: RESULT ───────────────────────────────────────────────────────────
  if (step === 'result' && importResults) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Import Complete</Text>
        </View>

        <View style={styles.resultContent}>
          <MaterialIcons name="check-circle" size={64} color={Colors.success} style={{ marginBottom: Spacing.lg }} />
          <Text style={styles.resultTitle}>Menu Imported!</Text>

          <View style={styles.resultGrid}>
            <View style={styles.resultCard}>
              <Text style={styles.resultNum}>{importResults.categoriesCreated}</Text>
              <Text style={styles.resultLabel}>Categories{'\n'}Created</Text>
            </View>
            <View style={styles.resultCard}>
              <Text style={styles.resultNum}>{importResults.productsCreated}</Text>
              <Text style={styles.resultLabel}>Products{'\n'}Created</Text>
            </View>
            <View style={styles.resultCard}>
              <Text style={styles.resultNum}>{importResults.productsOverwritten}</Text>
              <Text style={styles.resultLabel}>Products{'\n'}Updated</Text>
            </View>
            <View style={styles.resultCard}>
              <Text style={styles.resultNum}>{importResults.productsSkipped}</Text>
              <Text style={styles.resultLabel}>Products{'\n'}Skipped</Text>
            </View>
          </View>

          {importResults.errors.length > 0 && (
            <View style={styles.errorsBox}>
              <Text style={styles.errorsTitle}>{importResults.errors.length} item(s) had errors:</Text>
              {importResults.errors.map((e, i) => (
                <Text key={i} style={styles.errorsItem}>• {e.name}: {e.reason}</Text>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.importBtn, { marginTop: Spacing.xl }]}
            onPress={() => navigation.navigate('BulkImageAssign')}
            activeOpacity={0.8}
          >
            <MaterialIcons name="add-photo-alternate" size={18} color={Colors.white} />
            <Text style={styles.importBtnText}>Add Product Images</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.importBtn, { marginTop: Spacing.sm, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border }]}
            onPress={() => {
              setStep('pick');
              setExtractedCategories([]);
              setDuplicates([]);
              setImportResults(null);
              setRestaurantName('');
            }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="upload" size={18} color={Colors.text} />
            <Text style={[styles.importBtnText, { color: Colors.text }]}>Import Another Menu</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.doneBtn, { marginTop: Spacing.md, marginBottom: bottom + Spacing.lg }]}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── STEP: REVIEW ───────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { setStep('pick'); setExtractedCategories([]); setDuplicates([]); }} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Review Menu</Text>
          {restaurantName ? <Text style={styles.headerSub}>{restaurantName}</Text> : null}
        </View>
        <Text style={styles.selectionCount}>{selectedProducts}/{totalProducts}</Text>
      </View>

      {duplicates.length > 0 && (
        <View style={styles.dupBanner}>
          <MaterialIcons name="warning" size={16} color={Colors.warning} />
          <Text style={styles.dupBannerText}>
            {duplicates.length} duplicate{duplicates.length !== 1 ? 's' : ''} found — choose action per item below
          </Text>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 + bottom }}>
        {extractedCategories.map((cat, ci) => (
          <View key={ci} style={styles.categoryBlock}>
            <TouchableOpacity
              style={styles.categoryHeader}
              onPress={() => setExpandedCategory(expandedCategory === ci ? null : ci)}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={expandedCategory === ci ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                size={22}
                color={Colors.text}
              />
              <Text style={styles.categoryName}>{cat.name}</Text>
              <Text style={styles.categoryCount}>
                {cat.products.filter(p => p.confidence !== -1).length}/{cat.products.length}
              </Text>
            </TouchableOpacity>

            {(expandedCategory === ci) && cat.products.map((prod, pi) => {
              const isExcluded = prod.confidence === -1;
              const isDup = isDuplicate(cat.name, prod.name);

              return (
                <View key={pi} style={[styles.productRow, isExcluded && styles.productRowExcluded]}>
                  <View style={styles.productRowLeft}>
                    <View style={[styles.vegDot, { backgroundColor: prod.veg ? Colors.veg : Colors.nonVeg }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.productName, isExcluded && { color: Colors.textMuted }]} numberOfLines={1}>
                        {prod.name}
                      </Text>
                      {prod.variant ? (
                        <Text style={styles.productVariant}>{prod.variant}</Text>
                      ) : null}
                      {isDup && !isExcluded && (
                        <View style={styles.dupRow}>
                          <Text style={styles.dupLabel}>Duplicate: </Text>
                          {(['skip', 'overwrite', 'copy'] as const).map(action => (
                            <TouchableOpacity
                              key={action}
                              style={[styles.dupBtn, prod.duplicateAction === action && styles.dupBtnActive]}
                              onPress={() => setDuplicateAction(cat.name, prod.name, action)}
                            >
                              <Text style={[styles.dupBtnText, prod.duplicateAction === action && styles.dupBtnTextActive]}>
                                {action === 'skip' ? 'Skip' : action === 'overwrite' ? 'Replace' : 'Copy'}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>

                  <View style={styles.productRowRight}>
                    <View style={styles.priceInputWrap}>
                      <Text style={styles.rupee}>₹</Text>
                      <TextInput
                        style={styles.priceInput}
                        value={prod.price != null ? prod.price.toString() : ''}
                        onChangeText={v => updateProductPrice(ci, pi, v)}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={Colors.textMuted}
                        editable={!isExcluded}
                      />
                    </View>
                    <Switch
                      value={!isExcluded}
                      onValueChange={() => toggleProductEnabled(ci, pi)}
                      trackColor={{ false: Colors.border, true: Colors.primary + '80' }}
                      thumbColor={isExcluded ? Colors.textMuted : Colors.primary}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {/* Import button */}
      <View style={[styles.importBar, { paddingBottom: bottom + Spacing.md }]}>
        <TouchableOpacity
          style={[styles.importBtn, processing && { opacity: 0.7 }]}
          onPress={handleImport}
          disabled={processing}
          activeOpacity={0.8}
        >
          {processing
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <MaterialIcons name="upload" size={20} color={Colors.white} />
          }
          <Text style={styles.importBtnText}>
            {processing ? 'Importing...' : `Import ${selectedProducts} product${selectedProducts !== 1 ? 's' : ''}`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.background },
  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  header: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn:     { padding: 4, marginRight: Spacing.sm },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  headerSub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },

  // Pick step
  pickContent: { padding: Spacing.lg, alignItems: 'center' },
  heroIcon:    { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.primary + '15', justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.lg, marginTop: Spacing.xl },
  heroTitle:   { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm, textAlign: 'center' },
  heroSubtitle:{ fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.xl },
  pickOptions: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.xl },
  pickCard: {
    flex: 1,
    alignItems:      'center',
    backgroundColor: Colors.surface,
    borderRadius:    BorderRadius.lg,
    padding:         Spacing.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    gap:             Spacing.xs,
  },
  pickCardTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  pickCardSub:   { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  tipBox: {
    flexDirection:  'row',
    gap:            Spacing.xs,
    backgroundColor: Colors.warning + '15',
    borderRadius:   BorderRadius.md,
    padding:        Spacing.md,
    alignItems:     'flex-start',
    width:          '100%',
  },
  tipText: { flex: 1, fontSize: FontSize.xs, color: Colors.text, lineHeight: 18 },
  errorBox: {
    flexDirection:   'row',
    gap:             Spacing.xs,
    backgroundColor: Colors.danger + '15',
    borderRadius:    BorderRadius.md,
    padding:         Spacing.md,
    alignItems:      'flex-start',
    width:           '100%',
    marginBottom:    Spacing.lg,
  },
  errorText: { flex: 1, fontSize: FontSize.sm, color: Colors.danger, lineHeight: 18 },

  // Processing step
  processingTitle:    { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginTop: Spacing.xl, textAlign: 'center' },
  processingSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 20 },

  // Review step
  selectionCount: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  dupBanner: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             Spacing.xs,
    backgroundColor: Colors.warning + '20',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.warning + '40',
  },
  dupBannerText: { fontSize: FontSize.xs, color: Colors.text, flex: 1 },

  categoryBlock: {
    marginHorizontal: Spacing.md,
    marginTop:        Spacing.md,
    backgroundColor:  Colors.surface,
    borderRadius:     BorderRadius.lg,
    borderWidth:      1,
    borderColor:      Colors.border,
    overflow:         'hidden',
  },
  categoryHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    padding:        Spacing.md,
    gap:            Spacing.sm,
    backgroundColor: Colors.surface,
  },
  categoryName:  { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  categoryCount: { fontSize: FontSize.xs, color: Colors.textSecondary },

  productRow: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    gap:               Spacing.sm,
  },
  productRowExcluded: { opacity: 0.4 },
  productRowLeft:  { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  productRowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  vegDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  productName:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  productVariant: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },

  dupRow:       { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.xs, gap: 4, flexWrap: 'wrap' },
  dupLabel:     { fontSize: FontSize.xs, color: Colors.warning, fontWeight: '600' },
  dupBtn: {
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      4,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  dupBtnActive:     { borderColor: Colors.primary, backgroundColor: Colors.primary + '20' },
  dupBtnText:       { fontSize: FontSize.xs, color: Colors.textSecondary },
  dupBtnTextActive: { color: Colors.primary, fontWeight: '700' },

  priceInputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: 6, height: 32 },
  rupee:     { fontSize: FontSize.sm, color: Colors.textSecondary },
  priceInput:{ fontSize: FontSize.sm, color: Colors.text, width: 56, textAlign: 'right', paddingVertical: 0 },

  // Import bar
  importBar: {
    backgroundColor:  Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.md,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
  },
  importBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius:    BorderRadius.lg,
    paddingVertical: Spacing.md,
  },
  importBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  // Result step
  resultContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  resultTitle:   { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, marginBottom: Spacing.xl },
  resultGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, justifyContent: 'center', marginBottom: Spacing.xl },
  resultCard: {
    width:           130,
    alignItems:      'center',
    backgroundColor: Colors.surface,
    borderRadius:    BorderRadius.lg,
    padding:         Spacing.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
  },
  resultNum:   { fontSize: 32, fontWeight: '800', color: Colors.primary },
  resultLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 },
  errorsBox: {
    backgroundColor: Colors.danger + '10',
    borderRadius:    BorderRadius.md,
    padding:         Spacing.md,
    width:           '100%',
    marginBottom:    Spacing.lg,
  },
  errorsTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.danger, marginBottom: Spacing.xs },
  errorsItem:  { fontSize: FontSize.xs, color: Colors.danger, lineHeight: 18 },
  doneBtn: {
    backgroundColor: Colors.surface,
    borderRadius:    BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    borderWidth:     1,
    borderColor:     Colors.border,
  },
  doneBtnText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
});

export default AIMenuImportScreen;
