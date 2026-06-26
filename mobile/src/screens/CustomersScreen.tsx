import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Print from 'expo-print';
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

  const exportPDF = async () => {
    if (customers.length === 0) {
      Alert.alert('No Data', 'No customers to export for this range');
      return;
    }
    setExporting(true);
    try {
      const hotelName = settings.hotelName || 'My Restaurant';
      const phone     = settings.phone     || '';
      const address   = settings.address   || '';
      const rangeLabel = RANGES.find(r => r.key === range)?.label || range;
      const now        = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const totalRevenue = customers.reduce((s, c) => s + c.totalSpent, 0);
      const totalOrders  = customers.reduce((s, c) => s + c.totalOrders, 0);

      const fmtDate = (iso: string) =>
        new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const fmtAmt = (n: number) =>
        `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

      const rows = customers.map((c, i) => `
        <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
          <td class="num">${i + 1}</td>
          <td class="name">${(c.customerName || 'Guest').replace(/</g, '&lt;')}</td>
          <td>${c.phone || '—'}</td>
          <td class="center">${c.totalOrders}</td>
          <td class="amt">${fmtAmt(c.totalSpent)}</td>
          <td class="center">${fmtDate(c.firstOrderDate)}</td>
          <td class="center">${fmtDate(c.lastOrderDate)}</td>
        </tr>`).join('');

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background:#fff; color:#1a1a1a; font-size:11px; }

  .page { padding:28px 32px; max-width:800px; margin:0 auto; }

  /* Header */
  .header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:18px; border-bottom:2.5px solid #E8380D; margin-bottom:20px; }
  .hotel-block .hotel-name { font-size:20px; font-weight:800; color:#1a1a1a; letter-spacing:-0.3px; }
  .hotel-block .hotel-sub  { font-size:11px; color:#666; margin-top:3px; }
  .report-block { text-align:right; }
  .report-block .report-title { font-size:15px; font-weight:800; color:#E8380D; }
  .report-block .report-meta  { font-size:10px; color:#888; margin-top:4px; line-height:1.6; }

  /* Summary cards */
  .summary { display:flex; gap:14px; margin-bottom:22px; }
  .card { flex:1; background:#FFF6EE; border:1.5px solid #F0D9C8; border-radius:10px; padding:14px 16px; }
  .card .val  { font-size:18px; font-weight:800; color:#E8380D; }
  .card .lbl  { font-size:9px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.5px; margin-top:3px; }

  /* Table */
  table { width:100%; border-collapse:collapse; font-size:10.5px; }
  thead tr { background:#E8380D; }
  thead th { color:#fff; padding:9px 10px; text-align:left; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.4px; }
  thead th.center { text-align:center; }
  thead th.amt    { text-align:right; }

  tbody tr.even { background:#fff; }
  tbody tr.odd  { background:#FFF9F6; }
  tbody tr:hover { background:#FFF2EB; }
  tbody td { padding:8px 10px; border-bottom:1px solid #F0E8E0; vertical-align:middle; }
  tbody td.num    { color:#aaa; font-size:9px; width:28px; }
  tbody td.name   { font-weight:600; color:#1a1a1a; }
  tbody td.center { text-align:center; color:#555; }
  tbody td.amt    { text-align:right; font-weight:700; color:#1a1a1a; }

  /* Total row */
  tfoot tr { background:#1a1a1a; }
  tfoot td { padding:9px 10px; color:#fff; font-weight:700; font-size:10.5px; border:none; }
  tfoot td.amt { text-align:right; }
  tfoot td.center { text-align:center; }

  /* Footer */
  .footer { margin-top:24px; padding-top:12px; border-top:1px solid #eee; display:flex; justify-content:space-between; font-size:9px; color:#bbb; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="hotel-block">
      <div class="hotel-name">${hotelName}</div>
      <div class="hotel-sub">${[address, phone].filter(Boolean).join('  ·  ')}</div>
    </div>
    <div class="report-block">
      <div class="report-title">Customer Report</div>
      <div class="report-meta">
        Period: ${rangeLabel}<br>
        Generated: ${now}
      </div>
    </div>
  </div>

  <div class="summary">
    <div class="card">
      <div class="val">${customers.length}</div>
      <div class="lbl">Total Customers</div>
    </div>
    <div class="card">
      <div class="val">${totalOrders}</div>
      <div class="lbl">Total Orders</div>
    </div>
    <div class="card">
      <div class="val">${fmtAmt(totalRevenue)}</div>
      <div class="lbl">Total Revenue</div>
    </div>
    <div class="card">
      <div class="val">${customers.length > 0 ? fmtAmt(totalRevenue / customers.length) : cur + '0'}</div>
      <div class="lbl">Avg. Spend / Customer</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Customer Name</th>
        <th>Phone</th>
        <th class="center">Orders</th>
        <th class="amt">Total Spent</th>
        <th class="center">First Order</th>
        <th class="center">Last Order</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="color:#aaa;font-weight:400;font-size:9px">— End of Report —</td>
        <td class="center">${totalOrders}</td>
        <td class="amt">${fmtAmt(totalRevenue)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    <span>${hotelName} · Customer Report · ${rangeLabel}</span>
    <span>Generated by Dine POS</span>
  </div>

</div>
</body>
</html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Customer Report PDF' });
    } catch {
      Alert.alert('Error', 'Failed to export customer report');
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
        <TouchableOpacity style={styles.exportBtn} onPress={exportPDF} disabled={exporting} activeOpacity={0.85}>
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
