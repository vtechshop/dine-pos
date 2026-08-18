import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Modal, TextInput,
  RefreshControl, ActivityIndicator, StyleSheet, Alert, Share,
  Linking, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, BorderRadius, Shadows } from '../utils/constants';
import { getVendors, getVendorStatement, createVendorPayment, getVendorPayments } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import type { Vendor, VendorLedgerStatement, VendorPayment, VendorPaymentMethod, LedgerEntryType } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const METHODS: Array<{ id: VendorPaymentMethod; label: string }> = [
  { id: 'cash',          label: 'Cash' },
  { id: 'upi',           label: 'UPI' },
  { id: 'bank_transfer', label: 'Bank Transfer' },
  { id: 'cheque',        label: 'Cheque' },
  { id: 'card',          label: 'Card' },
];

const ENTRY_COLOR: Record<LedgerEntryType, string> = {
  grn:             '#C62828',
  payment:         '#2E7D32',
  opening_balance: '#1565C0',
  adjustment:      '#E65100',
  debit_note:      '#C62828',
  credit_note:     '#2E7D32',
  purchase:        '#4527A0',
};

const ENTRY_LABEL: Record<LedgerEntryType, string> = {
  grn:             'GRN',
  payment:         'Payment',
  opening_balance: 'Opening Balance',
  adjustment:      'Adjustment',
  debit_note:      'Debit Note',
  credit_note:     'Credit Note',
  purchase:        'Purchase',
};

function fmt(n: number, sym = '₹') { return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ── Payment Modal ─────────────────────────────────────────────────────────────

type PaymentModalProps = {
  visible:   boolean;
  vendor:    Vendor | null;
  onClose:   () => void;
  onCreated: (p: VendorPayment) => void;
};

function PaymentModal({ visible, vendor, onClose, onCreated }: PaymentModalProps) {
  const { settings } = useSettings();
  const sym = settings.currencySymbol || '₹';
  const [paymentDate, setDate]   = useState(todayISO());
  const [method, setMethod]      = useState<VendorPaymentMethod>('cash');
  const [amount, setAmount]      = useState('');
  const [reference, setRef]      = useState('');
  const [notes, setNotes]        = useState('');
  const [saving, setSaving]      = useState(false);

  function reset() {
    setDate(todayISO()); setMethod('cash'); setAmount(''); setRef(''); setNotes('');
  }

  function close() { if (!saving) { reset(); onClose(); } }

  async function submit() {
    if (!vendor) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Validation', 'Enter a valid amount'); return; }
    setSaving(true);
    try {
      const p = await createVendorPayment({
        vendorId: vendor._id,
        paymentDate,
        paymentMethod: method,
        amount: amt,
        referenceNumber: reference || undefined,
        notes: notes || undefined,
      });
      reset();
      onCreated(p);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create payment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalWrap}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={close} disabled={saving} style={styles.modalClose}>
              <MaterialIcons name="close" size={22} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Record Payment</Text>
            <View style={{ width: 36 }} />
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {vendor && (
              <View style={styles.vendorChip}>
                <Text style={styles.vendorChipName}>{vendor.businessName}</Text>
                <Text style={styles.vendorChipOwing}>Outstanding: {fmt(vendor.currentOutstanding, sym)}</Text>
              </View>
            )}

            {/* Date */}
            <Text style={styles.fieldLabel}>Payment Date</Text>
            <TextInput
              style={styles.input}
              value={paymentDate}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
            />

            {/* Method */}
            <Text style={styles.fieldLabel}>Payment Method</Text>
            <View style={styles.methodRow}>
              {METHODS.map(m => (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.methodPill, method === m.id && styles.methodPillActive]}
                  onPress={() => setMethod(m.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.methodPillText, method === m.id && styles.methodPillTextActive]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Amount */}
            <Text style={styles.fieldLabel}>Amount *</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textMuted}
            />

            {/* Reference */}
            <Text style={styles.fieldLabel}>Reference / Cheque No.</Text>
            <TextInput
              style={styles.input}
              value={reference}
              onChangeText={setRef}
              placeholder="Optional"
              placeholderTextColor={Colors.textMuted}
            />

            {/* Notes */}
            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional"
              multiline
              placeholderTextColor={Colors.textMuted}
            />
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.submitBtn, saving && { opacity: 0.6 }]}
              onPress={() => void submit()}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitBtnText}>Record Payment</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Statement Modal ───────────────────────────────────────────────────────────

type StatementModalProps = {
  vendor:    Vendor | null;
  onClose:   () => void;
  onPayNow:  () => void;
};

function StatementModal({ vendor, onClose, onPayNow }: StatementModalProps) {
  const { settings } = useSettings();
  const sym = settings.currencySymbol || '₹';
  const [data, setData]       = useState<VendorLedgerStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [tab, setTab]         = useState<'ledger' | 'payments'>('ledger');

  const loadData = useCallback(() => {
    if (!vendor) return;
    setLoading(true);
    Promise.all([
      getVendorStatement(vendor._id),
      getVendorPayments({ vendorId: vendor._id, limit: 50 }),
    ])
      .then(([stmt, pays]) => { setData(stmt); setPayments(pays.payments); })
      .catch(() => Alert.alert('Error', 'Failed to load statement'))
      .finally(() => setLoading(false));
  }, [vendor]);

  React.useEffect(() => { if (vendor) loadData(); }, [vendor, loadData]);

  async function callVendor() {
    if (!vendor?.mobile) return;
    await Linking.openURL(`tel:${vendor.mobile}`).catch(() => {});
  }

  async function whatsApp() {
    if (!vendor?.mobile) return;
    const num = vendor.mobile.replace(/[^0-9]/g, '');
    await Linking.openURL(`https://wa.me/91${num}`).catch(() => {});
  }

  async function shareStatement() {
    if (!data || !vendor) return;
    const lines = [
      `Vendor Statement — ${vendor.businessName}`,
      `Outstanding: ${fmt(data.currentOutstanding, sym)}`,
      '',
      'Date         | Type            | Debit      | Credit     | Balance',
      ...data.entries.map(e =>
        `${fmtDate(e.createdAt).padEnd(12)} | ${(ENTRY_LABEL[e.entryType] ?? e.entryType).padEnd(15)} | ${(e.debit > 0 ? fmt(e.debit, sym) : '').padEnd(10)} | ${(e.credit > 0 ? fmt(e.credit, sym) : '').padEnd(10)} | ${fmt(e.runningBalance, sym)}`
      ),
    ];
    await Share.share({ message: lines.join('\n'), title: `Statement - ${vendor.businessName}` });
  }

  const visible = vendor !== null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}>
            <MaterialIcons name="close" size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.modalTitle} numberOfLines={1}>{vendor?.businessName ?? ''}</Text>
            <Text style={styles.outstandingBadge}>{fmt(vendor?.currentOutstanding ?? 0, sym)} outstanding</Text>
          </View>
          <TouchableOpacity onPress={() => void shareStatement()} style={styles.modalClose}>
            <MaterialIcons name="share" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Action bar */}
        <View style={styles.actionBar}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => void callVendor()} activeOpacity={0.7}>
            <MaterialIcons name="phone" size={18} color={Colors.primary} />
            <Text style={styles.actionBtnLabel}>Call</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => void whatsApp()} activeOpacity={0.7}>
            <MaterialIcons name="chat" size={18} color="#25D366" />
            <Text style={styles.actionBtnLabel}>WhatsApp</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={onPayNow} activeOpacity={0.7}>
            <MaterialIcons name="payments" size={18} color="#fff" />
            <Text style={[styles.actionBtnLabel, { color: '#fff', fontWeight: '700' }]}>Pay Now</Text>
          </TouchableOpacity>
        </View>

        {/* Tab switcher */}
        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'ledger' && styles.tabBtnActive]} onPress={() => setTab('ledger')}>
            <Text style={[styles.tabBtnText, tab === 'ledger' && styles.tabBtnTextActive]}>Ledger</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'payments' && styles.tabBtnActive]} onPress={() => setTab('payments')}>
            <Text style={[styles.tabBtnText, tab === 'payments' && styles.tabBtnTextActive]}>Payments</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : tab === 'ledger' ? (
          !data || data.entries.length === 0 ? (
            <View style={styles.center}>
              <MaterialIcons name="receipt-long" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No ledger entries yet</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }}>
              {/* Summary */}
              <View style={styles.summaryRow}>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryCellLabel}>Total Debit</Text>
                  <Text style={[styles.summaryCellVal, { color: Colors.danger }]}>{fmt(data.totalDebit, sym)}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryCellLabel}>Total Credit</Text>
                  <Text style={[styles.summaryCellVal, { color: Colors.success }]}>{fmt(data.totalCredit, sym)}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryCellLabel}>Outstanding</Text>
                  <Text style={[styles.summaryCellVal, { color: Colors.danger }]}>{fmt(data.currentOutstanding, sym)}</Text>
                </View>
              </View>

              {[...data.entries].reverse().map(e => (
                <View key={e._id} style={styles.entryRow}>
                  <View style={[styles.entryDot, { backgroundColor: ENTRY_COLOR[e.entryType] ?? Colors.primary }]} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.entryTopRow}>
                      <Text style={[styles.entryType, { color: ENTRY_COLOR[e.entryType] ?? Colors.primary }]}>
                        {ENTRY_LABEL[e.entryType] ?? e.entryType}
                      </Text>
                      <Text style={styles.entryDate}>{fmtDate(e.createdAt)}</Text>
                    </View>
                    {e.referenceNumber ? (
                      <Text style={styles.entryRef}>#{e.referenceNumber}</Text>
                    ) : null}
                    {e.description ? (
                      <Text style={styles.entryDesc} numberOfLines={1}>{e.description}</Text>
                    ) : null}
                  </View>
                  <View style={styles.entryAmts}>
                    {e.debit > 0 && <Text style={styles.entryDebit}>{fmt(e.debit, sym)}</Text>}
                    {e.credit > 0 && <Text style={styles.entryCredit}>{fmt(e.credit, sym)}</Text>}
                    <Text style={styles.entryBalance}>{fmt(e.runningBalance, sym)}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )
        ) : (
          payments.length === 0 ? (
            <View style={styles.center}>
              <MaterialIcons name="payments" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No payments yet</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }}>
              {payments.map(p => (
                <View key={p._id} style={[styles.payRow, p.isReversed && { opacity: 0.5 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payNumber}>{p.paymentNumber}</Text>
                    <Text style={styles.payMeta}>{fmtDate(p.paymentDate)} · {METHODS.find(m => m.id === p.paymentMethod)?.label ?? p.paymentMethod}</Text>
                    {p.referenceNumber ? <Text style={styles.payRef}>Ref: {p.referenceNumber}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.payAmount}>{fmt(p.amount, sym)}</Text>
                    {p.isReversed ? (
                      <Text style={styles.payReversed}>Reversed</Text>
                    ) : (
                      <Text style={styles.payActive}>Active</Text>
                    )}
                  </View>
                </View>
              ))}
            </ScrollView>
          )
        )}
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function VendorLedgerScreen() {
  const { settings } = useSettings();
  const sym = settings.currencySymbol || '₹';
  const [vendors, setVendors]           = useState<Vendor[]>([]);
  const [loading, setLoading]           = useState(false);
  const [refreshing, setRefreshing]     = useState(false);
  const [search, setSearch]             = useState('');
  const [selectedVendor, setSelected]   = useState<Vendor | null>(null);
  const [payModalVendor, setPayModal]   = useState<Vendor | null>(null);

  const loadVendors = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await getVendors({ limit: 200 });
      const sorted = [...r.vendors].sort((a, b) => b.currentOutstanding - a.currentOutstanding);
      setVendors(sorted);
    } catch {
      Alert.alert('Error', 'Failed to load vendors');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadVendors(); }, [loadVendors]));

  function onRefresh() { setRefreshing(true); void loadVendors(true); }

  const filtered = vendors.filter(v =>
    !search.trim() ||
    v.businessName.toLowerCase().includes(search.toLowerCase()) ||
    v.mobile.includes(search),
  );

  const totalOutstanding = vendors.reduce((s, v) => s + v.currentOutstanding, 0);

  function openStatement(v: Vendor) {
    setSelected(v);
  }

  function handlePayNow() {
    setPayModal(selectedVendor);
  }

  function handlePaymentCreated() {
    setPayModal(null);
    // Refresh data and re-open statement with fresh vendor data
    void loadVendors(true);
  }

  const renderVendor = ({ item }: { item: Vendor }) => (
    <TouchableOpacity
      style={styles.vendorRow}
      onPress={() => openStatement(item)}
      activeOpacity={0.7}
    >
      <View style={styles.vendorAvatar}>
        <Text style={styles.vendorAvatarText}>
          {item.businessName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.vendorName}>{item.businessName}</Text>
        <Text style={styles.vendorMobile}>{item.mobile} · {item.vendorCode}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[
          styles.vendorOutstanding,
          item.currentOutstanding > 0 ? { color: Colors.danger } : { color: Colors.success },
        ]}>
          {fmt(item.currentOutstanding, sym)}
        </Text>
        {item.currentOutstanding > 0 && (
          <Text style={styles.vendorOwing}>Owing</Text>
        )}
      </View>
      <MaterialIcons name="chevron-right" size={20} color={Colors.textMuted} style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen}>
      {/* Summary card */}
      <View style={styles.summaryCard}>
        <View>
          <Text style={styles.summaryCardLabel}>Total Outstanding</Text>
          <Text style={styles.summaryCardVal}>{fmt(totalOutstanding, sym)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.summaryCardLabel}>Vendors</Text>
          <Text style={styles.summaryCardVal}>{vendors.length}</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <MaterialIcons name="search" size={18} color={Colors.textMuted} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search vendor or mobile…"
          placeholderTextColor={Colors.textMuted}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <MaterialIcons name="close" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item._id}
          renderItem={renderVendor}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <MaterialIcons name="store" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>{search ? 'No vendors match your search' : 'No vendors found'}</Text>
            </View>
          }
          contentContainerStyle={filtered.length === 0 ? { flex: 1 } : { paddingBottom: 24 }}
        />
      )}

      {/* Statement Modal */}
      <StatementModal
        vendor={selectedVendor}
        onClose={() => setSelected(null)}
        onPayNow={handlePayNow}
      />

      {/* Payment Modal */}
      <PaymentModal
        visible={payModalVendor !== null}
        vendor={payModalVendor}
        onClose={() => setPayModal(null)}
        onCreated={handlePaymentCreated}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex:            1,
    backgroundColor: Colors.background,
  },
  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingBottom:  60,
    gap:            12,
  },
  emptyText: {
    fontSize: FontSize.sm,
    color:    Colors.textMuted,
  },

  // Summary
  summaryCard: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    backgroundColor: Colors.surface,
    margin:          12,
    borderRadius:    BorderRadius.lg,
    padding:         14,
    borderWidth:     1,
    borderColor:     Colors.border,
    ...Shadows.sm,
  },
  summaryCardLabel: {
    fontSize: FontSize.xs,
    color:    Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryCardVal: {
    fontSize:   20,
    fontWeight: '800',
    color:      Colors.text,
    marginTop:  2,
  },

  // Search
  searchWrap: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 12,
    marginBottom:     8,
    borderRadius:    BorderRadius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    paddingHorizontal: 12,
    paddingVertical:   8,
  },
  searchInput: {
    flex:      1,
    fontSize:  FontSize.sm,
    color:     Colors.text,
  },

  // Vendor row
  vendorRow: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 12,
    marginVertical:   4,
    borderRadius:    BorderRadius.md,
    padding:         12,
    borderWidth:     1,
    borderColor:     Colors.border,
    ...Shadows.sm,
  },
  vendorAvatar: {
    width:           38,
    height:          38,
    borderRadius:    19,
    backgroundColor: Colors.primaryBg,
    alignItems:      'center',
    justifyContent:  'center',
    marginRight:     10,
  },
  vendorAvatarText: {
    fontSize:   16,
    fontWeight: '800',
    color:      Colors.primary,
  },
  vendorName: {
    fontSize:   FontSize.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  vendorMobile: {
    fontSize: FontSize.xs,
    color:    Colors.textMuted,
    marginTop: 2,
  },
  vendorOutstanding: {
    fontSize:   FontSize.sm,
    fontWeight: '800',
  },
  vendorOwing: {
    fontSize:   10,
    color:      Colors.danger,
    fontWeight: '600',
    marginTop:  1,
  },

  // Modal base
  modalWrap: {
    flex:            1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical:   14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalClose: {
    padding: 4,
    width:   36,
    alignItems: 'center',
  },
  modalTitle: {
    flex:       1,
    textAlign:  'center',
    fontSize:   FontSize.md,
    fontWeight: '700',
    color:      Colors.text,
  },
  outstandingBadge: {
    fontSize:   FontSize.xs,
    color:      Colors.danger,
    fontWeight: '700',
    marginTop:  2,
  },

  // Action bar
  actionBar: {
    flexDirection:   'row',
    gap:             8,
    paddingHorizontal: 12,
    paddingVertical:   10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  actionBtn: {
    flex:            1,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             4,
    paddingVertical: 8,
    borderRadius:    BorderRadius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    backgroundColor: Colors.card,
  },
  actionBtnPrimary: {
    backgroundColor: Colors.primary,
    borderColor:     Colors.primaryDark,
  },
  actionBtnLabel: {
    fontSize:   FontSize.xs,
    fontWeight: '600',
    color:      Colors.textSecondary,
  },

  // Tabs
  tabRow: {
    flexDirection:   'row',
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabBtn: {
    paddingHorizontal: 20,
    paddingVertical:   10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: Colors.primary,
  },
  tabBtnText: {
    fontSize:   FontSize.sm,
    fontWeight: '600',
    color:      Colors.textMuted,
  },
  tabBtnTextActive: {
    color: Colors.primary,
  },

  // Statement summary
  summaryRow: {
    flexDirection:  'row',
    margin:          12,
    gap:             8,
  },
  summaryCell: {
    flex:            1,
    backgroundColor: Colors.surface,
    borderRadius:    BorderRadius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         10,
    alignItems:      'center',
  },
  summaryCellLabel: {
    fontSize: 10,
    color:    Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryCellVal: {
    fontSize:   FontSize.sm,
    fontWeight: '800',
    marginTop:  3,
  },

  // Ledger entries
  entryRow: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    paddingHorizontal: 12,
    paddingVertical:   10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor:   Colors.surface,
    marginHorizontal:  0,
  },
  entryDot: {
    width:        6,
    height:       6,
    borderRadius: 3,
    marginTop:    6,
    marginRight:  8,
  },
  entryTopRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
  },
  entryType: {
    fontSize:   FontSize.xs,
    fontWeight: '700',
  },
  entryDate: {
    fontSize: FontSize.xs,
    color:    Colors.textMuted,
  },
  entryRef: {
    fontSize: 11,
    color:    Colors.textMuted,
    marginTop: 2,
  },
  entryDesc: {
    fontSize: 11,
    color:    Colors.textMuted,
    marginTop: 1,
  },
  entryAmts: {
    alignItems:  'flex-end',
    marginLeft:  8,
  },
  entryDebit: {
    fontSize:   FontSize.xs,
    fontWeight: '700',
    color:      Colors.danger,
  },
  entryCredit: {
    fontSize:   FontSize.xs,
    fontWeight: '700',
    color:      Colors.success,
  },
  entryBalance: {
    fontSize:   FontSize.xs,
    fontWeight: '800',
    color:      Colors.text,
    marginTop:  2,
  },

  // Payment rows
  payRow: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: 12,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor:   Colors.surface,
  },
  payNumber: {
    fontSize:   FontSize.sm,
    fontWeight: '700',
    color:      Colors.primary,
  },
  payMeta: {
    fontSize: FontSize.xs,
    color:    Colors.textMuted,
    marginTop: 2,
  },
  payRef: {
    fontSize: 11,
    color:    Colors.textMuted,
    marginTop: 1,
  },
  payAmount: {
    fontSize:   FontSize.md,
    fontWeight: '800',
    color:      Colors.success,
  },
  payActive: {
    fontSize:   10,
    color:      Colors.success,
    fontWeight: '600',
    marginTop:  2,
  },
  payReversed: {
    fontSize:   10,
    color:      Colors.danger,
    fontWeight: '600',
    marginTop:  2,
  },

  // Payment form
  vendorChip: {
    backgroundColor: Colors.primaryBg,
    borderRadius:    BorderRadius.md,
    padding:         12,
    marginBottom:    16,
    borderWidth:     1,
    borderColor:     Colors.border,
  },
  vendorChipName: {
    fontSize:   FontSize.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  vendorChipOwing: {
    fontSize:   FontSize.xs,
    color:      Colors.danger,
    fontWeight: '600',
    marginTop:  3,
  },
  fieldLabel: {
    fontSize:      FontSize.xs,
    fontWeight:    '700',
    color:         Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom:  6,
    marginTop:     14,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth:     1,
    borderColor:     Colors.border,
    borderRadius:    BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical:   10,
    fontSize:        FontSize.sm,
    color:           Colors.text,
  },
  methodRow: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           6,
  },
  methodPill: {
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderRadius:      BorderRadius.round,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.surface,
  },
  methodPillActive: {
    backgroundColor: Colors.primary,
    borderColor:     Colors.primaryDark,
  },
  methodPillText: {
    fontSize:   FontSize.xs,
    fontWeight: '600',
    color:      Colors.textSecondary,
  },
  methodPillTextActive: {
    color: '#fff',
  },
  modalFooter: {
    padding:         16,
    borderTopWidth:  1,
    borderTopColor:  Colors.border,
    backgroundColor: Colors.surface,
  },
  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius:    BorderRadius.md,
    paddingVertical: 14,
    alignItems:      'center',
  },
  submitBtnText: {
    fontSize:   FontSize.md,
    fontWeight: '800',
    color:      '#fff',
  },
});
