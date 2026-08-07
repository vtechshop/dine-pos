import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';

type InvoiceStatus = 'all' | 'draft' | 'verified' | 'paid' | 'cancelled';

const STATUS_COLORS: Record<string, string> = {
  draft:     '#F59E0B',
  verified:  Colors.primary,
  paid:      Colors.success,
  cancelled: Colors.danger,
};

const STATUS_LABELS: Record<string, string> = {
  draft:     'Draft',
  verified:  'Verified',
  paid:      'Paid',
  cancelled: 'Cancelled',
};

const todayStr = () => new Date().toISOString().slice(0, 10);

interface Invoice extends Record<string, any> {
  _id: string;
  invoiceNumber: string;
  vendorInvoiceNo?: string;
  invoiceDate: string;
  vendorSnapshot?: { businessName?: string };
  grandTotal: number;
  status: string;
}

const PurchaseInvoiceScreen: React.FC = () => {
  const { settings } = useSettings();
  const { bottom } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [status, setStatus]       = useState<InvoiceStatus>('all');
  const [page, setPage]           = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [form, setForm] = useState({
    vendorId: '',
    vendorInvoiceNo: '',
    invoiceDate: todayStr(),
    subtotal: '',
    taxTotal: '',
    freight: '',
    discount: '',
    notes: '',
  });

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page: p };
      if (status !== 'all') params.status = status;
      const data = await api.getPurchaseInvoices(params);
      if (p === 1) setInvoices(data.invoices as Invoice[]);
      else setInvoices(prev => [...prev, ...(data.invoices as Invoice[])]);
      setTotal(data.total);
      setPage(p);
    } catch {
      Alert.alert('Error', 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useFocusEffect(useCallback(() => { load(1); }, [load]));

  const create = async () => {
    if (!form.vendorId.trim()) { Alert.alert('Validation', 'Vendor ID is required'); return; }
    const subtotal  = parseFloat(form.subtotal)  || 0;
    const taxTotal  = parseFloat(form.taxTotal)  || 0;
    const freight   = parseFloat(form.freight)   || 0;
    const discount  = parseFloat(form.discount)  || 0;
    const grandTotal = subtotal + taxTotal + freight - discount;

    setSaving(true);
    try {
      await api.createPurchaseInvoice({
        vendorId:       form.vendorId.trim(),
        vendorInvoiceNo: form.vendorInvoiceNo.trim() || undefined,
        invoiceDate:    form.invoiceDate,
        subtotal,
        taxTotal,
        freight,
        discount,
        grandTotal,
        notes:          form.notes.trim() || undefined,
      });
      setShowCreate(false);
      setForm({ vendorId: '', vendorInvoiceNo: '', invoiceDate: todayStr(), subtotal: '', taxTotal: '', freight: '', discount: '', notes: '' });
      load(1);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  const verify = (id: string) => {
    Alert.alert('Verify Invoice', 'Mark this invoice as verified?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Verify', onPress: async () => {
          setActionLoading(id);
          try {
            await api.verifyPurchaseInvoice(id);
            load(1);
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Failed to verify');
          } finally { setActionLoading(null); }
        },
      },
    ]);
  };

  const markPaid = (id: string) => {
    Alert.alert('Mark as Paid', 'Enter payment reference:', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Paid', onPress: async () => {
          setActionLoading(id);
          try {
            await api.markPurchaseInvoicePaid(id, 'MANUAL');
            load(1);
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Failed to mark paid');
          } finally { setActionLoading(null); }
        },
      },
    ]);
  };

  const renderInvoice = ({ item }: { item: Invoice }) => {
    const statusColor = STATUS_COLORS[item.status] ?? Colors.textMuted;
    const isActioning = actionLoading === item._id;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.invoiceNum}>{item.invoiceNumber}</Text>
            {item.vendorInvoiceNo && <Text style={styles.vendorInvoiceNum}>Vendor: {item.vendorInvoiceNo}</Text>}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{STATUS_LABELS[item.status] ?? item.status}</Text>
          </View>
        </View>

        <View style={styles.cardRow}>
          <Text style={styles.vendorName}>
            {item.vendorSnapshot?.businessName ?? 'Unknown Vendor'}
          </Text>
          <Text style={styles.amount}>{fmt(item.grandTotal)}</Text>
        </View>

        <Text style={styles.date}>{new Date(item.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>

        {isActioning ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} />
        ) : (
          <View style={styles.actionRow}>
            {item.status === 'draft' && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => verify(item._id)}>
                <MaterialIcons name="verified" size={14} color={Colors.primary} />
                <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Verify</Text>
              </TouchableOpacity>
            )}
            {(item.status === 'draft' || item.status === 'verified') && (
              <TouchableOpacity style={styles.actionBtn} onPress={() => markPaid(item._id)}>
                <MaterialIcons name="payments" size={14} color={Colors.success} />
                <Text style={[styles.actionBtnText, { color: Colors.success }]}>Mark Paid</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom }]}>
      {/* Filter tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={{ gap: 8, paddingHorizontal: Spacing.md }}>
        {(['all', 'draft', 'verified', 'paid', 'cancelled'] as InvoiceStatus[]).map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.tab, status === s && styles.tabActive]}
            onPress={() => setStatus(s)}
          >
            <Text style={[styles.tabText, status === s && styles.tabTextActive]}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.toolbar}>
        <Text style={styles.countText}>{total} invoice{total !== 1 ? 's' : ''}</Text>
        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreate(true)}>
          <MaterialIcons name="add" size={18} color={Colors.white} />
          <Text style={styles.createBtnText}>New Invoice</Text>
        </TouchableOpacity>
      </View>

      {loading && page === 1 ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={item => item._id}
          renderItem={renderInvoice}
          contentContainerStyle={{ padding: Spacing.md }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="receipt-long" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No invoices found</Text>
            </View>
          }
          onEndReached={() => { if (invoices.length < total) load(page + 1); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loading && page > 1 ? <ActivityIndicator color={Colors.primary} style={{ margin: 16 }} /> : null}
        />
      )}

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Purchase Invoice</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <MaterialIcons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">

            <Text style={styles.fieldLabel}>Vendor ID *</Text>
            <TextInput style={styles.input} placeholder="MongoDB ObjectId of the vendor" placeholderTextColor={Colors.textMuted} value={form.vendorId} onChangeText={v => setForm(f => ({ ...f, vendorId: v }))} />

            <Text style={styles.fieldLabel}>Vendor Invoice No.</Text>
            <TextInput style={styles.input} placeholder="Supplier's own invoice number" placeholderTextColor={Colors.textMuted} value={form.vendorInvoiceNo} onChangeText={v => setForm(f => ({ ...f, vendorInvoiceNo: v }))} />

            <Text style={styles.fieldLabel}>Invoice Date *</Text>
            <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} value={form.invoiceDate} onChangeText={v => setForm(f => ({ ...f, invoiceDate: v }))} />

            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Subtotal</Text>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={Colors.textMuted} value={form.subtotal} onChangeText={v => setForm(f => ({ ...f, subtotal: v }))} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Tax</Text>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={Colors.textMuted} value={form.taxTotal} onChangeText={v => setForm(f => ({ ...f, taxTotal: v }))} keyboardType="decimal-pad" />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Freight</Text>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={Colors.textMuted} value={form.freight} onChangeText={v => setForm(f => ({ ...f, freight: v }))} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Discount</Text>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={Colors.textMuted} value={form.discount} onChangeText={v => setForm(f => ({ ...f, discount: v }))} keyboardType="decimal-pad" />
              </View>
            </View>

            {/* Grand total preview */}
            {(form.subtotal || form.taxTotal) && (
              <View style={styles.totalPreview}>
                <Text style={styles.totalPreviewLabel}>Grand Total (preview)</Text>
                <Text style={styles.totalPreviewVal}>
                  {fmt((parseFloat(form.subtotal) || 0) + (parseFloat(form.taxTotal) || 0) + (parseFloat(form.freight) || 0) - (parseFloat(form.discount) || 0))}
                </Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput style={[styles.input, { minHeight: 60 }]} placeholder="Optional notes" placeholderTextColor={Colors.textMuted} value={form.notes} onChangeText={v => setForm(f => ({ ...f, notes: v }))} multiline />

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={create} disabled={saving}>
              {saving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.saveBtnText}>Create Invoice</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  tabs: { backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border, maxHeight: 52 },
  tab: { paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.border },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: Colors.white },

  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  countText: { fontSize: FontSize.sm, color: Colors.textMuted },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.md },
  createBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },

  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.sm, ...Shadows.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  invoiceNum: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  vendorInvoiceNum: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.round },
  statusText: { fontSize: FontSize.xs, fontWeight: '700' },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  vendorName: { fontSize: FontSize.sm, color: Colors.textSecondary },
  amount: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  date: { fontSize: FontSize.xs, color: Colors.textMuted },
  actionRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border },
  actionBtnText: { fontSize: FontSize.xs, fontWeight: '600' },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: FontSize.lg, color: Colors.textMuted, marginTop: Spacing.md },

  modal: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  modalBody: { padding: Spacing.md },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: 4, marginTop: Spacing.sm },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.sm, fontSize: FontSize.md, color: Colors.text },
  totalPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.primary + '10', padding: Spacing.sm, borderRadius: BorderRadius.md, marginTop: Spacing.sm },
  totalPreviewLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  totalPreviewVal: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  saveBtn: { backgroundColor: Colors.primary, padding: Spacing.md, borderRadius: BorderRadius.md, alignItems: 'center', marginTop: Spacing.lg, marginBottom: 40 },
  saveBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },
});

export default PurchaseInvoiceScreen;
