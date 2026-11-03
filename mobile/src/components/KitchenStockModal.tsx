import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, Modal,
  ActivityIndicator, Switch, Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getKitchenProducts, setKitchenProductAvailability } from '../services/api';
import type { Product } from '../types';
import { Colors, FontSize, Spacing, BorderRadius } from '../utils/constants';

type Filter = 'all' | 'out';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Kitchen "Stock" list: every dish with an on/off switch. Off = out of stock —
 * the dish can't be ordered at the counter, by waiters or on QR until it's
 * switched back on.
 */
const KitchenStockModal: React.FC<Props> = ({ visible, onClose }) => {
  const { top, bottom } = useSafeAreaInsets();
  const [items, setItems]     = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [filter, setFilter]   = useState<Filter>('all');
  const [busyId, setBusyId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await getKitchenProducts();
      setItems([...list].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load menu items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (visible) void load(); }, [visible, load]);

  const outCount = useMemo(() => items.filter(p => !p.isAvailable).length, [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(p => {
      if (filter === 'out' && p.isAvailable) return false;
      return !q || p.name.toLowerCase().includes(q) || (p.shortCode ?? '').toLowerCase().includes(q);
    });
  }, [items, query, filter]);

  const toggle = async (p: Product, next: boolean) => {
    setBusyId(p._id);
    setItems(prev => prev.map(x => (x._id === p._id ? { ...x, isAvailable: next } : x)));   // feels instant
    try {
      await setKitchenProductAvailability(p._id, next);
    } catch (e) {
      setItems(prev => prev.map(x => (x._id === p._id ? { ...x, isAvailable: !next } : x))); // undo
      Alert.alert('Not changed', e instanceof Error ? e.message : 'Could not update this dish');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.container, { paddingTop: top + Spacing.sm, paddingBottom: bottom }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Stock</Text>
            <Text style={styles.sub}>
              {outCount === 0 ? 'Everything is available' : `${outCount} dish${outCount === 1 ? '' : 'es'} out of stock`}
            </Text>
          </View>
          <TouchableOpacity style={styles.iconBtn} onPress={load} accessibilityLabel="Refresh">
            <MaterialIcons name="refresh" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={onClose} accessibilityLabel="Close">
            <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Search + filter */}
        <View style={styles.searchRow}>
          <MaterialIcons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search dish…"
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <MaterialIcons name="close" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.chips}>
          {([['all', `All (${items.length})`], ['out', `Out of stock (${outCount})`]] as [Filter, string][]).map(([k, label]) => (
            <TouchableOpacity
              key={k}
              onPress={() => setFilter(k)}
              style={[styles.chip, filter === k && styles.chipOn]}
            >
              <Text style={[styles.chipText, filter === k && styles.chipTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* List */}
        {loading && items.length === 0 ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={p => p._id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.lg }}
            ListEmptyComponent={
              <Text style={styles.empty}>{filter === 'out' ? 'Nothing is out of stock.' : 'No dishes match.'}</Text>
            }
            renderItem={({ item: p }) => (
              <View style={[styles.row, !p.isAvailable && styles.rowOut]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, !p.isAvailable && styles.nameOut]} numberOfLines={1}>{p.name}</Text>
                  <Text style={[styles.state, { color: p.isAvailable ? Colors.success : Colors.danger }]}>
                    {p.isAvailable ? 'Available' : 'Out of stock'}
                    {p.stock >= 0 ? `  ·  ${p.stock} left` : ''}
                  </Text>
                </View>
                {busyId === p._id && <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 8 }} />}
                <Switch
                  value={p.isAvailable}
                  onValueChange={v => void toggle(p, v)}
                  disabled={busyId === p._id}
                  trackColor={{ false: Colors.dangerBg, true: Colors.successBg }}
                  thumbColor={p.isAvailable ? Colors.success : Colors.danger}
                  accessibilityLabel={`${p.name} ${p.isAvailable ? 'available' : 'out of stock'}`}
                />
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  title: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.md, paddingHorizontal: Spacing.md, height: 44,
    borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  searchInput: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  chips: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },
  chipTextOn: { color: '#FFFFFF' },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: Spacing.md,
    marginBottom: 6, borderRadius: BorderRadius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowOut: { backgroundColor: Colors.dangerBg },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  nameOut: { color: Colors.textSecondary },
  state: { fontSize: FontSize.xs, fontWeight: '600', marginTop: 2 },
  center: { alignItems: 'center', marginTop: 40, paddingHorizontal: Spacing.lg },
  errorText: { color: Colors.danger, textAlign: 'center', fontSize: FontSize.sm },
  retryBtn: { marginTop: Spacing.md, paddingHorizontal: 16, paddingVertical: 8, borderRadius: BorderRadius.md, backgroundColor: Colors.primary },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  empty: { textAlign: 'center', color: Colors.textMuted, marginTop: 40, fontSize: FontSize.sm },
});

export default KitchenStockModal;
