import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';
import { Customer } from '../types';
import { PremiumGate } from '../components/PremiumGate';

type RangeKey = 'today' | 'week' | 'month' | 'all';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all',   label: 'All Time' },
];

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

const getRangeParams = (key: RangeKey): { from?: string; to?: string } => {
  if (key === 'all') return {};
  const to = new Date();
  const from = new Date();
  if (key === 'week') from.setDate(from.getDate() - 7);
  else if (key === 'month') from.setDate(from.getDate() - 30);
  return { from: toDateStr(from), to: toDateStr(to) };
};

// Normalise to a WhatsApp-callable number (assumes India +91 when no country code given)
const toWhatsAppNumber = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const CustomersScreen: React.FC = () => {
  const { settings } = useSettings();
  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const [range, setRange] = useState<RangeKey>('month');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getCustomers(getRangeParams(range));
      setCustomers(result.customers);
    } catch {
      Alert.alert('Error', 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sendWhatsApp = (c: Customer) => {
    const name = c.customerName || 'there';
    const message = `Hi ${name}! 👋 Thank you for ordering from ${settings.hotelName}. We'd love to serve you again soon! 🍽️`;
    const number = toWhatsAppNumber(c.phone);
    const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'WhatsApp is not installed or the number is invalid'));
  };

  const exportCSV = async () => {
    if (customers.length === 0) {
      Alert.alert('No Data', 'No customers to export for this range');
      return;
    }
    setExporting(true);
    try {
      const header = 'Name,Phone,Total Orders,Total Spent,Last Order,First Order\n';
      const rows = customers.map(c => {
        const name = (c.customerName || 'Guest').replace(/"/g, '');
        const last = new Date(c.lastOrderDate).toLocaleDateString('en-IN');
        const first = new Date(c.firstOrderDate).toLocaleDateString('en-IN');
        return `"${name}","${c.phone}",${c.totalOrders},${c.totalSpent},"${last}","${first}"`;
      }).join('\n');
      const csv = header + rows;

      const fileUri = `${FileSystem.cacheDirectory}customers_${range}_${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export Customers' });
      } else {
        Alert.alert('Saved', `File saved to ${fileUri}`);
      }
    } catch {
      Alert.alert('Error', 'Failed to export customer data');
    } finally {
      setExporting(false);
    }
  };

  const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);

  const renderCustomer = ({ item }: { item: Customer }) => (
    <View style={styles.card}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(item.customerName || 'G').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: Spacing.md }}>
        <Text style={styles.custName}>{item.customerName || 'Guest'}</Text>
        <Text style={styles.custPhone}>{item.phone}</Text>
        <View style={styles.custMetaRow}>
          <Text style={styles.custMeta}>{item.totalOrders} order{item.totalOrders !== 1 ? 's' : ''}</Text>
          <Text style={styles.custMetaDot}>·</Text>
          <Text style={styles.custMeta}>Last {new Date(item.lastOrderDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.custSpent}>{fmt(item.totalSpent)}</Text>
        <TouchableOpacity style={styles.waBtn} onPress={() => sendWhatsApp(item)} activeOpacity={0.8}>
          <MaterialIcons name="chat" size={16} color={Colors.white} />
          <Text style={styles.waBtnText}>WhatsApp</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Customers</Text>
        <TouchableOpacity style={styles.exportBtn} onPress={exportCSV} disabled={exporting} activeOpacity={0.85}>
          {exporting
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <MaterialIcons name="file-download" size={18} color={Colors.white} />}
          <Text style={styles.exportBtnText}>Export</Text>
        </TouchableOpacity>
      </View>

      {/* Range filter */}
      <View style={styles.rangeRow}>
        {RANGES.map(r => (
          <TouchableOpacity
            key={r.key}
            style={[styles.rangeChip, range === r.key && styles.rangeChipActive]}
            onPress={() => setRange(r.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.rangeChipText, range === r.key && styles.rangeChipTextActive]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={customers}
          renderItem={renderCustomer}
          keyExtractor={c => c.phone}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            customers.length > 0 ? (
              <View style={styles.summaryBar}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{customers.length}</Text>
                  <Text style={styles.summaryLabel}>Customers</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{fmt(totalRevenue)}</Text>
                  <Text style={styles.summaryLabel}>Total Revenue</Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="people-outline" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No Customers</Text>
              <Text style={styles.emptyText}>No customer phone numbers recorded for this period</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.lg, paddingVertical: 10, ...Shadows.primary,
  },
  exportBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },

  rangeRow: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  rangeChip: {
    flex: 1, paddingVertical: 8, borderRadius: BorderRadius.round,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
  },
  rangeChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rangeChipText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary },
  rangeChipTextActive: { color: Colors.white },

  list: { padding: Spacing.lg, paddingBottom: 100 },

  summaryBar: {
    flexDirection: 'row', backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '30',
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: Colors.primary + '30' },
  summaryValue: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary },
  summaryLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  custName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  custPhone: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  custMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  custMeta: { fontSize: FontSize.xs, color: Colors.textMuted },
  custMetaDot: { fontSize: FontSize.xs, color: Colors.textMuted },
  custSpent: { fontSize: FontSize.md, fontWeight: '800', color: Colors.success, marginBottom: 6 },
  waBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#25D366', borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  waBtnText: { color: Colors.white, fontSize: 11, fontWeight: '700' },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm, textAlign: 'center', paddingHorizontal: Spacing.xl },
});

const CustomersScreenGated: React.FC = () => (
  <PremiumGate feature="Customer CRM" description="View customer order history, export data, and send WhatsApp messages to keep customers coming back.">
    <CustomersScreen />
  </PremiumGate>
);

export default CustomersScreenGated;
