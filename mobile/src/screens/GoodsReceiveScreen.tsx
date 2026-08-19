import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, Alert, ScrollView,
  RefreshControl, KeyboardAvoidingView, Platform, Share,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import type { GRN, GRNStatus, PurchaseOrder } from '../types';
import type { GRNInput, GRNItemInput } from '../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<GRNStatus, { bg: string; text: string }> = {
  pending:   { bg: '#F1F5F9', text: '#64748B' },
  partial:   { bg: '#FEF3C7', text: '#D97706' },
  completed: { bg: '#D1FAE5', text: '#059669' },
  cancelled: { bg: '#FEE2E2', text: '#DC2626' },
};

const STATUS_LABELS: Record<GRNStatus, string> = {
  pending:   'Pending',
  partial:   'Partial',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── GRN Row ───────────────────────────────────────────────────────────────────

function GRNRow({ grn, onPress }: { grn: GRN; onPress: () => void }) {
  const s = STATUS_COLORS[grn.status];
  const totalRcv = grn.items.reduce((sum, i) => sum + i.receivedQty, 0);
  const totalDmg = grn.items.reduce((sum, i) => sum + i.damagedQty, 0);
  return (
    <TouchableOpacity style={styles.grnRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.grnRowTop}>
        <Text style={styles.grnNumber}>{grn.grnNumber}</Text>
        <View style={[styles.badge, { backgroundColor: s.bg }]}>
          <Text style={[styles.badgeText, { color: s.text }]}>{STATUS_LABELS[grn.status]}</Text>
        </View>
      </View>
      <Text style={styles.grnVendor} numberOfLines={1}>{grn.vendorSnapshot.businessName}</Text>
      <Text style={styles.grnPO}>Against {grn.poNumber}</Text>
      <View style={styles.grnRowBottom}>
        <Text style={styles.grnDate}>{fmtDate(grn.receiveDate)}</Text>
        <Text style={styles.grnItems}>{grn.items.length} items</Text>
        <Text style={styles.grnRcv}>✓ {totalRcv.toFixed(1)}</Text>
        {totalDmg > 0 && <Text style={styles.grnDmg}>⚠ {totalDmg.toFixed(1)}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ── GRN Detail Modal ──────────────────────────────────────────────────────────

function GRNDetailModal({
  grn, visible, onClose, onChange,
}: {
  grn:      GRN;
  visible:  boolean;
  onClose:  () => void;
  onChange: (updated: GRN) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason]         = useState('');

  const s = STATUS_COLORS[grn.status];

  async function doCancel() {
    setCancelling(true);
    try {
      const updated = await api.cancelGRN(grn._id, reason);
      onChange(updated);
      setShowCancel(false);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  }

  async function doShare() {
    const lines = [
      `GRN: ${grn.grnNumber}`,
      `PO: ${grn.poNumber}`,
      `Vendor: ${grn.vendorSnapshot.businessName}`,
      `Date: ${fmtDate(grn.receiveDate)}`,
      `Status: ${STATUS_LABELS[grn.status]}`,
      '',
      'Items:',
      ...grn.items.map(i =>
        `• ${i.productName}: ${i.receivedQty} ${i.unit}${i.damagedQty ? ` (${i.damagedQty} dmg)` : ''}${i.batchNumber ? ` [${i.batchNumber}]` : ''}`
      ),
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch { /* user cancelled */ }
  }

  const totalRcv = grn.items.reduce((s, i) => s + i.receivedQty, 0);
  const totalDmg = grn.items.reduce((s, i) => s + i.damagedQty, 0);
  const totalRej = grn.items.reduce((s, i) => s + i.rejectedQty, 0);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.modalHeaderCode}>{grn.grnNumber}</Text>
            <Text style={styles.modalHeaderName}>{grn.vendorSnapshot.businessName}</Text>
            <Text style={styles.modalHeaderSub}>Against {grn.poNumber}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Status */}
          <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
            <Text style={[styles.statusPillText, { color: s.text }]}>{STATUS_LABELS[grn.status]}</Text>
          </View>

          {/* Summary cards */}
          <View style={styles.finCards}>
            <View style={styles.finCard}>
              <Text style={styles.finLabel}>Received</Text>
              <Text style={[styles.finValue, { color: '#059669' }]}>{totalRcv.toFixed(2)}</Text>
            </View>
            {totalDmg > 0 && (
              <View style={[styles.finCard, { borderColor: '#FCD34D' }]}>
                <Text style={[styles.finLabel, { color: '#D97706' }]}>Damaged</Text>
                <Text style={[styles.finValue, { color: '#D97706' }]}>{totalDmg.toFixed(2)}</Text>
              </View>
            )}
            {totalRej > 0 && (
              <View style={[styles.finCard, { borderColor: '#FCA5A5' }]}>
                <Text style={[styles.finLabel, { color: '#DC2626' }]}>Rejected</Text>
                <Text style={[styles.finValue, { color: '#DC2626' }]}>{totalRej.toFixed(2)}</Text>
              </View>
            )}
            <View style={styles.finCard}>
              <Text style={styles.finLabel}>Date</Text>
              <Text style={[styles.finValue, { fontSize: FontSize.sm }]}>{fmtDate(grn.receiveDate)}</Text>
            </View>
          </View>

          {/* Items */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Items</Text>
            {grn.items.map((item, i) => (
              <View key={i} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{item.productName}</Text>
                  {item.variantName ? <Text style={styles.itemMeta}>{item.variantName}</Text> : null}
                  <Text style={styles.itemMeta}>{item.unit} · Price: {item.purchasePrice}</Text>
                  {item.batchNumber ? <Text style={styles.itemMeta}>Batch: {item.batchNumber}</Text> : null}
                  {item.expiryDate  ? <Text style={[styles.itemMeta, new Date(item.expiryDate) < new Date() && { color: '#DC2626' }]}>
                    Exp: {fmtDate(item.expiryDate)}
                  </Text> : null}
                  {item.warehouse   ? <Text style={styles.itemMeta}>📦 {item.warehouse}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.itemRcv}>✓ {item.receivedQty}</Text>
                  {item.damagedQty  > 0 && <Text style={styles.itemDmg}>⚠ {item.damagedQty}</Text>}
                  {item.rejectedQty > 0 && <Text style={styles.itemRej}>✗ {item.rejectedQty}</Text>}
                  <Text style={styles.itemPending}>{item.pendingQty} left</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Notes */}
          {!!grn.notes && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Notes</Text>
              <Text style={styles.notesText}>{grn.notes}</Text>
            </View>
          )}

          {/* Cancel reason */}
          {!!grn.cancelReason && (
            <View style={[styles.section, styles.cancelSection]}>
              <Text style={styles.cancelTitle}>Cancellation Reason</Text>
              <Text style={styles.cancelText}>{grn.cancelReason}</Text>
            </View>
          )}

          {/* Cancel input */}
          {showCancel && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reason for Cancellation</Text>
              <TextInput
                value={reason} onChangeText={setReason}
                placeholder="Enter reason…"
                placeholderTextColor={Colors.textSecondary}
                multiline style={styles.cancelInput}
              />
              <View style={styles.actionRow}>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnOutline]} onPress={() => setShowCancel(false)}>
                  <Text style={styles.actionBtnOutlineText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#EF4444', flex: 1 }]}
                  onPress={() => void doCancel()} disabled={cancelling}
                >
                  {cancelling ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Confirm Cancel</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Action bar */}
        {!showCancel && (
          <View style={styles.actionBar}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnOutline, { flex: 0, paddingHorizontal: 16 }]}
              onPress={() => void doShare()}>
              <MaterialIcons name="share" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
            {grn.status !== 'cancelled' && grn.status !== 'completed' && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#EF4444', flex: 1 }]}
                onPress={() => setShowCancel(true)} disabled={cancelling}
              >
                <MaterialIcons name="block" size={14} color="#fff" style={{ marginRight: 4 }} />
                <Text style={styles.actionBtnText}>Cancel GRN</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Receive Form Modal ────────────────────────────────────────────────────────

type FormItem = {
  _key:         string;
  poItemIndex:  number;
  productName:  string;
  variantName:  string;
  orderedQty:   number;
  alreadyRcv:   number;
  receivedQty:  string;
  damagedQty:   string;
  rejectedQty:  string;
  unit:         string;
  purchasePrice: string;
  batchNumber:  string;
  expiryDate:   string;
  warehouse:    string;
};

interface ReceiveFormProps {
  visible:  boolean;
  po:       PurchaseOrder;
  onClose:  () => void;
  onSaved:  (grn: GRN) => void;
}

function ReceiveFormModal({ visible, po, onClose, onSaved }: ReceiveFormProps) {
  const [receiveDate, setReceiveDate] = useState(todayISO());
  const [notes, setNotes]             = useState('');
  const [saving, setSaving]           = useState(false);
  const [items, setItems]             = useState<FormItem[]>(() =>
    po.items.map((pi, idx) => ({
      _key:         String(idx),
      poItemIndex:  idx,
      productName:  pi.productName,
      variantName:  pi.variantName ?? '',
      orderedQty:   pi.orderedQty,
      alreadyRcv:   pi.receivedQty || 0,
      receivedQty:  String(Math.max(0, pi.orderedQty - (pi.receivedQty || 0))),
      damagedQty:   '0',
      rejectedQty:  '0',
      unit:         pi.unit,
      purchasePrice: String(pi.unitPrice),
      batchNumber:  '',
      expiryDate:   '',
      warehouse:    '',
    })),
  );

  // Re-init when PO changes
  React.useEffect(() => {
    setItems(po.items.map((pi, idx) => ({
      _key:         String(idx),
      poItemIndex:  idx,
      productName:  pi.productName,
      variantName:  pi.variantName ?? '',
      orderedQty:   pi.orderedQty,
      alreadyRcv:   pi.receivedQty || 0,
      receivedQty:  String(Math.max(0, pi.orderedQty - (pi.receivedQty || 0))),
      damagedQty:   '0',
      rejectedQty:  '0',
      unit:         pi.unit,
      purchasePrice: String(pi.unitPrice),
      batchNumber:  '',
      expiryDate:   '',
      warehouse:    '',
    })));
    setReceiveDate(todayISO());
    setNotes('');
    setSaving(false);
  }, [po]);

  function setField(key: string, field: keyof FormItem, val: string) {
    setItems(prev => prev.map(i => i._key === key ? { ...i, [field]: val } : i));
  }

  async function submit() {
    if (items.every(i => (parseFloat(i.receivedQty) || 0) === 0)) {
      Alert.alert('Error', 'Enter at least one received quantity');
      return;
    }
    setSaving(true);
    try {
      const payload: GRNInput = {
        poId: po._id,
        receiveDate: receiveDate || undefined,
        notes: notes || undefined,
        items: items.map<GRNItemInput>(i => ({
          poItemIndex:   i.poItemIndex,
          productName:   i.productName,
          variantName:   i.variantName || undefined,
          orderedQty:    i.orderedQty,
          receivedQty:   parseFloat(i.receivedQty) || 0,
          damagedQty:    parseFloat(i.damagedQty) || 0,
          rejectedQty:   parseFloat(i.rejectedQty) || 0,
          unit:          i.unit,
          purchasePrice: parseFloat(i.purchasePrice) || 0,
          batchNumber:   i.batchNumber || undefined,
          expiryDate:    i.expiryDate || undefined,
          warehouse:     i.warehouse || undefined,
        })),
      };
      const grn = await api.createGRN(payload);
      onSaved(grn);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create GRN');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalHeaderCode}>{po.poNumber}</Text>
              <Text style={styles.modalHeaderName}>Receive from {po.vendorSnapshot.businessName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled">

            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Receive Date</Text>
                <TextInput value={receiveDate} onChangeText={setReceiveDate}
                  placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textSecondary}
                  style={styles.fieldInput} />
              </View>
              <View style={{ flex: 1.5, marginLeft: 8 }}>
                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput value={notes} onChangeText={setNotes}
                  placeholder="Optional notes…" placeholderTextColor={Colors.textSecondary}
                  style={styles.fieldInput} />
              </View>
            </View>

            <Text style={styles.sectionTitle}>Items</Text>

            {items.map(item => (
              <View key={item._key} style={styles.itemCard}>
                <View style={styles.itemCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.productName}</Text>
                    {item.variantName ? <Text style={styles.itemMeta}>{item.variantName}</Text> : null}
                    <Text style={styles.itemMeta}>
                      Ordered: {item.orderedQty} {item.unit}
                      {item.alreadyRcv > 0 ? ` · Done: ${item.alreadyRcv}` : ''}
                    </Text>
                  </View>
                </View>

                {/* Qty fields */}
                <View style={styles.rowFields}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.miniLabel}>Received *</Text>
                    <TextInput
                      value={item.receivedQty}
                      onChangeText={v => setField(item._key, 'receivedQty', v)}
                      keyboardType="decimal-pad"
                      placeholderTextColor={Colors.textSecondary}
                      style={styles.miniInput}
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.miniLabel}>Damaged</Text>
                    <TextInput
                      value={item.damagedQty}
                      onChangeText={v => setField(item._key, 'damagedQty', v)}
                      keyboardType="decimal-pad"
                      placeholderTextColor={Colors.textSecondary}
                      style={styles.miniInput}
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.miniLabel}>Rejected</Text>
                    <TextInput
                      value={item.rejectedQty}
                      onChangeText={v => setField(item._key, 'rejectedQty', v)}
                      keyboardType="decimal-pad"
                      placeholderTextColor={Colors.textSecondary}
                      style={styles.miniInput}
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.miniLabel}>Price</Text>
                    <TextInput
                      value={item.purchasePrice}
                      onChangeText={v => setField(item._key, 'purchasePrice', v)}
                      keyboardType="decimal-pad"
                      placeholderTextColor={Colors.textSecondary}
                      style={styles.miniInput}
                    />
                  </View>
                </View>

                {/* Batch / Expiry / Warehouse */}
                <View style={styles.rowFields}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.miniLabel}>Batch No.</Text>
                    <TextInput
                      value={item.batchNumber}
                      onChangeText={v => setField(item._key, 'batchNumber', v)}
                      placeholder="Optional"
                      placeholderTextColor={Colors.textSecondary}
                      style={styles.miniInput}
                    />
                  </View>
                  <View style={{ flex: 1.5, marginLeft: 8 }}>
                    <Text style={styles.miniLabel}>Expiry (YYYY-MM-DD)</Text>
                    <TextInput
                      value={item.expiryDate}
                      onChangeText={v => setField(item._key, 'expiryDate', v)}
                      placeholder="Optional"
                      placeholderTextColor={Colors.textSecondary}
                      style={styles.miniInput}
                    />
                  </View>
                  <View style={{ flex: 1.5, marginLeft: 8 }}>
                    <Text style={styles.miniLabel}>Warehouse</Text>
                    <TextInput
                      value={item.warehouse}
                      onChangeText={v => setField(item._key, 'warehouse', v)}
                      placeholder="e.g. Store A"
                      placeholderTextColor={Colors.textSecondary}
                      style={styles.miniInput}
                    />
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actionBar}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnOutline, { flex: 0, paddingHorizontal: 16 }]}
              onPress={onClose} disabled={saving}>
              <MaterialIcons name="close" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.primary, flex: 1 }]}
              onPress={() => void submit()} disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <MaterialIcons name="check-circle" size={16} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.actionBtnText}>Confirm Receipt</Text>
                  </>
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── PO Selector Modal ─────────────────────────────────────────────────────────

function POSelectorModal({
  visible, onClose, onSelect,
}: {
  visible:  boolean;
  onClose:  () => void;
  onSelect: (po: PurchaseOrder) => void;
}) {
  const [pos, setPOs]         = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');

  const load = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([
        api.getPurchaseOrders({ status: 'approved',           limit: 50 }),
        api.getPurchaseOrders({ status: 'sent',               limit: 50 }),
        api.getPurchaseOrders({ status: 'partially_received', limit: 50 }),
      ]);
      const all = [...a.purchaseOrders, ...b.purchaseOrders, ...c.purchaseOrders];
      const seen = new Set<string>();
      setPOs(all.filter(p => { if (seen.has(p._id)) return false; seen.add(p._id); return true; }));
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load POs');
    } finally {
      setLoading(false);
    }
  }, [visible]);

  useFocusEffect(useCallback(() => { if (visible) void load(); }, [visible, load]));
  React.useEffect(() => { if (visible) void load(); }, [visible, load]);

  const filtered = pos.filter(p =>
    !search.trim() ||
    p.poNumber.toLowerCase().includes(search.toLowerCase()) ||
    p.vendorSnapshot.businessName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Select Purchase Order</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={[styles.modalBody, { flex: 0, borderBottomWidth: 1, borderBottomColor: Colors.border }]}>
          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search PO or vendor…"
            placeholderTextColor={Colors.textSecondary}
            style={[styles.fieldInput, { marginBottom: 0 }]}
          />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.primary} size="large" />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={p => p._id}
            ListEmptyComponent={
              <View style={styles.centered}>
                <MaterialIcons name="local-shipping" size={40} color={Colors.border} />
                <Text style={styles.emptyText}>No receivable POs</Text>
                <Text style={[styles.emptyText, { fontSize: FontSize.xs, marginTop: 4 }]}>
                  Approve POs before receiving
                </Text>
              </View>
            }
            renderItem={({ item: po }) => {
              const pending = po.items.reduce((s, i) => s + Math.max(0, i.orderedQty - (i.receivedQty || 0)), 0);
              return (
                <TouchableOpacity style={styles.poSelectRow} onPress={() => onSelect(po)} activeOpacity={0.7}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={styles.grnNumber}>{po.poNumber}</Text>
                      <Text style={[styles.badgeText, {
                        color: po.status === 'partially_received' ? '#D97706' : '#059669',
                      }]}>
                        {po.status === 'partially_received' ? 'Partial' : po.status}
                      </Text>
                    </View>
                    <Text style={styles.grnVendor}>{po.vendorSnapshot.businessName}</Text>
                    <Text style={styles.grnMeta}>{po.items.length} items · {pending.toFixed(1)} units pending</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function GoodsReceiveScreen() {
  const insets = useSafeAreaInsets();

  const [grns, setGRNs]           = useState<GRN[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [detailGRN, setDetailGRN]     = useState<GRN | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectedPO, setSelectedPO]   = useState<PurchaseOrder | null>(null);
  const [formOpen, setFormOpen]       = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { grns: g, total: t } = await api.getGRNs({ limit: 100 });
      setGRNs(g); setTotal(t);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load GRNs');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function onRefresh() {
    setRefreshing(true);
    void load(true);
  }

  function onPOSelected(po: PurchaseOrder) {
    setSelectorOpen(false);
    setSelectedPO(po);
    setFormOpen(true);
  }

  function onGRNCreated(grn: GRN) {
    setFormOpen(false);
    setSelectedPO(null);
    setGRNs(prev => [grn, ...prev]);
    setTotal(t => t + 1);
    setDetailGRN(grn);
  }

  function onGRNChanged(grn: GRN) {
    setGRNs(prev => prev.map(g => g._id === grn._id ? grn : g));
    setDetailGRN(grn);
  }

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <Text style={styles.headerCount}>{total} GRN{total !== 1 ? 's' : ''}</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setSelectorOpen(true)}>
          <MaterialIcons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* GRN list */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={grns}
          keyExtractor={g => g._id}
          renderItem={({ item }) => (
            <GRNRow grn={item} onPress={() => setDetailGRN(item)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <MaterialIcons name="inventory" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No goods received yet</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setSelectorOpen(true)}>
                <Text style={styles.emptyBtnText}>Receive Goods</Text>
              </TouchableOpacity>
            </View>
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      )}

      {/* PO Selector */}
      <POSelectorModal
        visible={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        onSelect={onPOSelected}
      />

      {/* Receive form */}
      {selectedPO && (
        <ReceiveFormModal
          visible={formOpen}
          po={selectedPO}
          onClose={() => { setFormOpen(false); setSelectedPO(null); }}
          onSaved={onGRNCreated}
        />
      )}

      {/* GRN detail */}
      {detailGRN && (
        <GRNDetailModal
          grn={detailGRN}
          visible={!!detailGRN}
          onClose={() => setDetailGRN(null)}
          onChange={onGRNChanged}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.background },
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  headerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 10 },
  headerCount: { fontSize: FontSize.sm, color: Colors.textSecondary },
  addBtn:      { width: 40, height: 40, borderRadius: BorderRadius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },

  grnRow:      { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: 12, ...Shadows.sm },
  grnRowTop:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  grnNumber:   { fontFamily: 'monospace', fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  grnVendor:   { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: 1 },
  grnPO:       { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 6 },
  grnRowBottom:{ flexDirection: 'row', alignItems: 'center', gap: 10 },
  grnDate:     { fontSize: FontSize.xs, color: Colors.textSecondary, flex: 1 },
  grnItems:    { fontSize: FontSize.xs, color: Colors.textSecondary },
  grnRcv:      { fontSize: FontSize.xs, color: '#059669', fontWeight: '600' },
  grnDmg:      { fontSize: FontSize.xs, color: '#D97706', fontWeight: '600' },
  grnMeta:     { fontSize: FontSize.xs, color: Colors.textSecondary },

  badge:       { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText:   { fontSize: 10, fontWeight: '600' },

  emptyText:   { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginTop: 12 },
  emptyBtn:    { marginTop: 16, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: BorderRadius.md },
  emptyBtnText:{ color: '#fff', fontSize: FontSize.sm, fontWeight: '600' },

  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalHeaderCode: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  modalHeaderName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: 2 },
  modalHeaderSub:  { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  modalTitle:  { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  closeBtn:    { padding: 4 },
  modalBody:   { flex: 1, padding: Spacing.md },

  statusPill:  { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 12 },
  statusPillText: { fontSize: FontSize.sm, fontWeight: '700' },

  finCards:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  finCard:     { flex: 1, minWidth: 80, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: 10, alignItems: 'center' },
  finLabel:    { fontSize: 10, color: Colors.textSecondary, marginBottom: 2 },
  finValue:    { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  section:     { marginTop: 16 },
  sectionTitle:{ fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },

  itemRow:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  itemName:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  itemMeta:    { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  itemRcv:     { fontSize: FontSize.sm, fontWeight: '700', color: '#059669' },
  itemDmg:     { fontSize: FontSize.xs, color: '#D97706' },
  itemRej:     { fontSize: FontSize.xs, color: '#DC2626' },
  itemPending: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },

  notesText:   { fontSize: FontSize.sm, color: Colors.textSecondary },
  cancelSection: { backgroundColor: '#FEE2E2', borderRadius: BorderRadius.sm, padding: 10 },
  cancelTitle: { fontSize: FontSize.xs, fontWeight: '700', color: '#DC2626', marginBottom: 4 },
  cancelText:  { fontSize: FontSize.sm, color: '#991B1B' },
  cancelInput: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FCA5A5', borderRadius: BorderRadius.sm, padding: 10, fontSize: FontSize.sm, color: Colors.text, minHeight: 60, textAlignVertical: 'top', marginBottom: 8 },

  actionBar:   { flexDirection: 'row', gap: 8, padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.surface },
  actionRow:   { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn:   { height: 44, borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, flexDirection: 'row' },
  actionBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: '600' },
  actionBtnOutline: { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  actionBtnOutlineText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500' },

  // Form
  fieldLabel:  { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldInput:  { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: FontSize.sm, color: Colors.text, marginBottom: 12 },
  rowFields:   { flexDirection: 'row', marginBottom: 8 },
  miniLabel:   { fontSize: 10, color: Colors.textSecondary, marginBottom: 3 },
  miniInput:   { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, paddingHorizontal: 8, paddingVertical: 7, fontSize: FontSize.xs, color: Colors.text },
  itemCard:    { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: 10, marginBottom: 8 },
  itemCardHeader: { marginBottom: 8 },

  // PO selector
  poSelectRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
});
