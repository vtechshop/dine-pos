import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { Table } from '../types';
import { PremiumGate } from '../components/PremiumGate';

const STATUS_COLORS: Record<Table['status'], string> = {
  available: Colors.success,
  occupied:  Colors.danger,
  reserved:  Colors.warning,
  inactive:  Colors.textMuted,
};
const STATUS_LABELS: Record<Table['status'], string> = {
  available: 'Available',
  occupied:  'Occupied',
  reserved:  'Reserved',
  inactive:  'Inactive',
};

const TableLayoutScreen: React.FC = () => {
  const { bottom } = useSafeAreaInsets();
  const [tables,    setTables]    = useState<Table[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTable, setEditTable] = useState<Table | null>(null);
  const [saving,    setSaving]    = useState(false);

  const [form, setForm] = useState({
    number: '', name: '', capacity: '4', shape: 'square' as 'square' | 'round',
  });

  const loadTables = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getTables();
      setTables(data);
    } catch {
      Alert.alert('Error', 'Failed to load tables');
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadTables(); }, [loadTables]));

  const openAdd = () => {
    setEditTable(null);
    setForm({ number: '', name: '', capacity: '4', shape: 'square' });
    setShowModal(true);
  };

  const openEdit = (t: Table) => {
    setEditTable(t);
    setForm({ number: String(t.number), name: t.name, capacity: String(t.capacity), shape: t.shape });
    setShowModal(true);
  };

  const saveTable = async () => {
    if (!form.number.trim()) { Alert.alert('Error', 'Table number required'); return; }
    setSaving(true);
    try {
      const payload = {
        number:   parseInt(form.number),
        name:     form.name.trim(),
        capacity: parseInt(form.capacity) || 4,
        shape:    form.shape,
      };
      if (editTable) {
        await api.updateTable(editTable._id, payload);
      } else {
        await api.createTable(payload);
      }
      setShowModal(false);
      loadTables();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const changeStatus = async (table: Table) => {
    const nextStatus: Record<Table['status'], Table['status']> = {
      available: 'occupied',
      occupied:  'available',
      reserved:  'available',
      inactive:  'available',
    };
    try {
      await api.updateTableStatus(table._id, nextStatus[table.status]);
      loadTables();
    } catch { Alert.alert('Error', 'Failed to update status'); }
  };

  const deleteTable = (table: Table) => {
    Alert.alert('Delete Table', `Delete Table ${table.number}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await api.deleteTable(table._id); loadTables(); }
          catch { Alert.alert('Error', 'Failed to delete'); }
        },
      },
    ]);
  };

  const summary = {
    available: tables.filter(t => t.status === 'available').length,
    occupied:  tables.filter(t => t.status === 'occupied').length,
    reserved:  tables.filter(t => t.status === 'reserved').length,
  };

  if (loading) return (
    <View style={styles.loader}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={styles.loaderText}>Loading floor map...</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 8 }}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { flex: 1 }]}>Floor Map</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <MaterialIcons name="add" size={22} color={Colors.white} />
          <Text style={styles.addBtnText}>Add Table</Text>
        </TouchableOpacity>
      </View>

      {/* Summary chips */}
      <View style={styles.summaryRow}>
        {[
          { label: 'Available', value: summary.available, color: Colors.success, bg: Colors.successBg },
          { label: 'Occupied',  value: summary.occupied,  color: Colors.danger,  bg: Colors.dangerBg },
          { label: 'Reserved',  value: summary.reserved,  color: Colors.warning, bg: Colors.warningBg },
        ].map(s => (
          <View key={s.label} style={[styles.summaryChip, { backgroundColor: s.bg, borderColor: s.color + '40' }]}>
            <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
            <Text style={[styles.summaryLabel, { color: s.color }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {tables.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons name="table-restaurant" size={56} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Tables Yet</Text>
            <Text style={styles.emptyText}>Tap "Add Table" to set up your floor map</Text>
          </View>
        ) : (
          tables.map(table => {
            const color  = STATUS_COLORS[table.status];
            const isRound = table.shape === 'round';
            return (
              <TouchableOpacity
                key={table._id}
                style={[
                  styles.tableCard,
                  isRound && styles.tableCardRound,
                  { borderColor: color, backgroundColor: color + '12' },
                ]}
                onPress={() => changeStatus(table)}
                onLongPress={() => openEdit(table)}
                activeOpacity={0.8}
              >
                <View style={[styles.statusDot, { backgroundColor: color }]} />
                <Text style={[styles.tableNum, { color }]}>T{table.number}</Text>
                {table.name ? <Text style={styles.tableName} numberOfLines={1}>{table.name}</Text> : null}
                <View style={styles.tableCapRow}>
                  <MaterialIcons name="people" size={12} color={Colors.textMuted} />
                  <Text style={styles.tableCap}>{table.capacity}</Text>
                </View>
                <Text style={[styles.tableStatus, { color }]}>{STATUS_LABELS[table.status]}</Text>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteTable(table)}>
                  <MaterialIcons name="close" size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <Text style={styles.hint}>Tap table to toggle status · Long press to edit</Text>

      {/* Add/Edit Modal */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modal, { paddingBottom: 36 + bottom }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{editTable ? 'Edit Table' : 'Add Table'}</Text>

            <Text style={styles.label}>Table Number *</Text>
            <TextInput
              style={styles.input}
              value={form.number}
              onChangeText={v => setForm(p => ({ ...p, number: v }))}
              keyboardType="number-pad"
              placeholder="e.g. 1"
              placeholderTextColor={Colors.textMuted}
            />

            <Text style={styles.label}>Name (optional)</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={v => setForm(p => ({ ...p, name: v }))}
              placeholder="e.g. Window, VIP"
              placeholderTextColor={Colors.textMuted}
            />

            <Text style={styles.label}>Capacity (seats)</Text>
            <TextInput
              style={styles.input}
              value={form.capacity}
              onChangeText={v => setForm(p => ({ ...p, capacity: v }))}
              keyboardType="number-pad"
              placeholder="4"
              placeholderTextColor={Colors.textMuted}
            />

            <Text style={styles.label}>Shape</Text>
            <View style={styles.shapeRow}>
              {(['square', 'round'] as const).map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.shapeBtn, form.shape === s && styles.shapeBtnActive]}
                  onPress={() => setForm(p => ({ ...p, shape: s }))}
                >
                  <MaterialIcons
                    name={s === 'square' ? 'crop-square' : 'radio-button-unchecked'}
                    size={22}
                    color={form.shape === s ? Colors.white : Colors.textSecondary}
                  />
                  <Text style={[styles.shapeTxt, form.shape === s && { color: Colors.white }]}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveTable} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.saveTxt}>{editTable ? 'Update' : 'Add Table'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const CARD_SIZE = 100;

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.background },
  loader:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  loaderText: { color: Colors.textSecondary, marginTop: Spacing.md },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    ...Shadows.primary,
  },
  addBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },

  summaryRow: {
    flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  summaryChip: {
    flex: 1, alignItems: 'center', paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg, borderWidth: 1,
  },
  summaryValue: { fontSize: FontSize.xxl, fontWeight: '800' },
  summaryLabel: { fontSize: FontSize.xs, fontWeight: '600', marginTop: 2 },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap', padding: Spacing.md,
    gap: Spacing.md, paddingBottom: 80,
  },
  tableCard: {
    width: CARD_SIZE, height: CARD_SIZE,
    borderRadius: BorderRadius.lg, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    ...Shadows.sm,
  },
  tableCardRound: { borderRadius: CARD_SIZE / 2 },
  statusDot: {
    position: 'absolute', top: 6, left: 6,
    width: 8, height: 8, borderRadius: 4,
  },
  tableNum:    { fontSize: FontSize.lg, fontWeight: '900' },
  tableName:   { fontSize: FontSize.xs, color: Colors.textSecondary, maxWidth: 80, textAlign: 'center' },
  tableCapRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  tableCap:    { fontSize: FontSize.xs, color: Colors.textMuted },
  tableStatus: { fontSize: 9, fontWeight: '700', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  deleteBtn: { position: 'absolute', top: 4, right: 4, padding: 2 },

  empty:      { flex: 1, alignItems: 'center', paddingVertical: 80, width: '100%' },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm, textAlign: 'center' },

  hint: { textAlign: 'center', color: Colors.textMuted, fontSize: FontSize.xs, padding: Spacing.md },

  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modal: {
    backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xxxl, borderTopRightRadius: BorderRadius.xxxl,
    padding: Spacing.xxl, paddingBottom: 36,
  },
  modalHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  modalTitle:  { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: Spacing.xl, textAlign: 'center' },

  label: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },

  shapeRow: { flexDirection: 'row', gap: Spacing.md },
  shapeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: BorderRadius.lg, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: Colors.card,
  },
  shapeBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  shapeTxt: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textSecondary },

  modalActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
  },
  cancelTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.lg },
  saveBtn: {
    flex: 2, paddingVertical: 14, borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary, alignItems: 'center', ...Shadows.primary,
  },
  saveTxt: { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },
});

const TableLayoutScreenGated: React.FC = () => (
  <PremiumGate feature="Table Layout" description="Manage your floor plan, track table status and seat your customers efficiently.">
    <TableLayoutScreen />
  </PremiumGate>
);

export default TableLayoutScreenGated;
