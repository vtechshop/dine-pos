import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, StatusBar, ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Category } from '../types';
import { getCategories, createCategory, updateCategory, deleteCategory } from '../services/api';
import { showAlert } from '../utils/alert';
import { Colors, Spacing, FontSize, BorderRadius } from '../utils/constants';

const PRESET_COLORS = [
  '#FF6B35', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6',
  '#EC4899', '#EF4444', '#06B6D4', '#84CC16', '#F97316',
  '#6366F1', '#14B8A6',
];

const PRESET_ICONS = [
  '🍽️', '🍜', '🍕', '🍔', '🥗', '🍱', '🥤', '☕',
  '🍰', '🥩', '🍗', '🌮', '🍣', '🥘', '🍲', '🍛',
  '🥪', '🍩', '🧃', '🍺',
];

const CategoriesScreen: React.FC = () => {
  const navigation = useNavigation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [selectedIcon, setSelectedIcon] = useState(PRESET_ICONS[0]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await getCategories();
      setCategories(data);
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchCategories(); }, [fetchCategories]));

  const openAdd = () => {
    setEditing(null);
    setName('');
    setSelectedColor(PRESET_COLORS[0]);
    setSelectedIcon(PRESET_ICONS[0]);
    setShowModal(true);
  };

  const openEdit = (cat: Category) => {
    setEditing(cat);
    setName(cat.name);
    setSelectedColor(cat.color || PRESET_COLORS[0]);
    setSelectedIcon(cat.icon || PRESET_ICONS[0]);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showAlert('Required', 'Category name is required');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await updateCategory(editing._id, {
          name: name.trim(), color: selectedColor, icon: selectedIcon,
        });
        setCategories(prev => prev.map(c => c._id === editing._id ? updated : c));
      } else {
        const created = await createCategory({
          name: name.trim(), color: selectedColor, icon: selectedIcon,
        });
        setCategories(prev => [...prev, created]);
      }
      setShowModal(false);
    } catch (error: any) {
      showAlert('Error', error.message || 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (cat: Category) => {
    showAlert(
      'Delete Category',
      `Delete "${cat.name}"? Products in this category will become uncategorized.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              await deleteCategory(cat._id);
              setCategories(prev => prev.filter(c => c._id !== cat._id));
            } catch (error: any) {
              showAlert('Error', error.message || 'Failed to delete');
            }
          },
        },
      ]
    );
  };

  const renderCategory = ({ item, index }: { item: Category; index: number }) => (
    <View style={styles.categoryRow}>
      <View style={styles.categoryLeft}>
        <View style={[styles.colorDot, { backgroundColor: item.color || PRESET_COLORS[index % PRESET_COLORS.length] }]}>
          <Text style={styles.colorDotIcon}>{item.icon || '🍽️'}</Text>
        </View>
        <View style={styles.categoryInfo}>
          <Text style={styles.categoryName}>{item.name}</Text>
          <Text style={styles.categorySortOrder}>Sort: {item.sortOrder ?? index + 1}</Text>
        </View>
      </View>
      <View style={styles.categoryActions}>
        <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
          <MaterialIcons name="edit" size={18} color={Colors.info} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
          <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Categories</Text>
        <TouchableOpacity style={styles.addHeaderBtn} onPress={openAdd}>
          <MaterialIcons name="add" size={24} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : categories.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="category" size={64} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No Categories Yet</Text>
          <Text style={styles.emptySubtext}>Create categories to organize your menu</Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={openAdd}>
            <MaterialIcons name="add" size={20} color={Colors.white} />
            <Text style={styles.emptyAddBtnText}>Add First Category</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={categories}
          renderItem={renderCategory}
          keyExtractor={item => item._id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      {/* FAB */}
      {categories.length > 0 && (
        <TouchableOpacity style={styles.fab} onPress={openAdd} activeOpacity={0.85}>
          <MaterialIcons name="add" size={28} color={Colors.white} />
        </TouchableOpacity>
      )}

      {/* Add/Edit Modal */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editing ? 'Edit Category' : 'New Category'}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <MaterialIcons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Preview */}
              <View style={styles.previewRow}>
                <View style={[styles.previewBadge, { backgroundColor: selectedColor + '30', borderColor: selectedColor }]}>
                  <Text style={styles.previewIcon}>{selectedIcon}</Text>
                  <Text style={[styles.previewName, { color: selectedColor }]}>
                    {name.trim() || 'Category Name'}
                  </Text>
                </View>
              </View>

              {/* Name */}
              <Text style={styles.fieldLabel}>Category Name *</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Starters, Main Course..."
                placeholderTextColor={Colors.textMuted}
                autoFocus
                maxLength={40}
              />

              {/* Icon Picker */}
              <Text style={styles.fieldLabel}>Icon</Text>
              <View style={styles.iconGrid}>
                {PRESET_ICONS.map(icon => (
                  <TouchableOpacity
                    key={icon}
                    style={[styles.iconOption, selectedIcon === icon && { backgroundColor: selectedColor + '40', borderColor: selectedColor }]}
                    onPress={() => setSelectedIcon(icon)}
                  >
                    <Text style={styles.iconOptionText}>{icon}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Color Picker */}
              <Text style={styles.fieldLabel}>Color</Text>
              <View style={styles.colorGrid}>
                {PRESET_COLORS.map(color => (
                  <TouchableOpacity
                    key={color}
                    style={[styles.colorOption, { backgroundColor: color }, selectedColor === color && styles.colorOptionSelected]}
                    onPress={() => setSelectedColor(color)}
                  >
                    {selectedColor === color && (
                      <MaterialIcons name="check" size={16} color={Colors.white} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: selectedColor }, saving && { opacity: 0.7 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <>
                    <MaterialIcons name={editing ? 'save' : 'add'} size={20} color={Colors.white} />
                    <Text style={styles.saveBtnText}>{editing ? 'Save Changes' : 'Create Category'}</Text>
                  </>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingTop: 50, paddingBottom: Spacing.lg,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { padding: Spacing.xs },
  headerTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: 'bold', flex: 1, textAlign: 'center' },
  addHeaderBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xxl },
  emptyTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: 'bold', marginTop: Spacing.lg },
  emptySubtext: { color: Colors.textSecondary, fontSize: FontSize.md, marginTop: Spacing.xs, textAlign: 'center' },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, marginTop: Spacing.xl,
  },
  emptyAddBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '600' },
  list: { padding: Spacing.lg },
  separator: { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.sm },
  categoryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.md, marginBottom: Spacing.sm,
  },
  categoryLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  colorDot: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginRight: Spacing.md },
  colorDotIcon: { fontSize: 22 },
  categoryInfo: { flex: 1 },
  categoryName: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '600' },
  categorySortOrder: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 },
  categoryActions: { flexDirection: 'row', gap: Spacing.sm },
  editBtn: { padding: Spacing.sm, backgroundColor: Colors.info + '20', borderRadius: BorderRadius.sm },
  deleteBtn: { padding: Spacing.sm, backgroundColor: Colors.danger + '20', borderRadius: BorderRadius.sm },
  fab: {
    position: 'absolute', right: Spacing.xl, bottom: Spacing.xl,
    width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', elevation: 8,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.xl, maxHeight: '90%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xl },
  modalTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: 'bold' },
  previewRow: { alignItems: 'center', marginBottom: Spacing.xl },
  previewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderWidth: 1.5, borderRadius: BorderRadius.xl, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg,
  },
  previewIcon: { fontSize: 20 },
  previewName: { fontSize: FontSize.lg, fontWeight: '700' },
  fieldLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600', marginBottom: Spacing.sm, marginTop: Spacing.md, letterSpacing: 0.5 },
  input: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.border, color: Colors.text, fontSize: FontSize.lg,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  iconOption: {
    width: 44, height: 44, borderRadius: BorderRadius.sm, borderWidth: 1.5,
    borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.card,
  },
  iconOptionText: { fontSize: 20 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginBottom: Spacing.xl },
  colorOption: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  colorOptionSelected: { borderWidth: 3, borderColor: Colors.white },
  saveBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.sm,
    borderRadius: BorderRadius.md, paddingVertical: Spacing.lg, marginTop: Spacing.md,
  },
  saveBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: 'bold' },
});

export default CategoriesScreen;
