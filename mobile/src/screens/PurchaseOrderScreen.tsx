import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, ScrollView,
  RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';
import type { PurchaseOrder, POStatus, Vendor } from '../types';
import type { POInput, POItemInput } from '../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<POStatus, { bg: string; text: string }> = {
  draft:              { bg: '#F1F5F9', text: '#64748B' },
  pending_approval:   { bg: '#FEF3C7', text: '#D97706' },
  approved:           { bg: '#D1FAE5', text: '#059669' },
  sent:               { bg: '#E0F2FE', text: '#0284C7' },
  partially_received: { bg: '#EDE9FE', text: '#7C3AED' },
  received:           { bg: '#DCFCE7', text: '#16A34A' },
  cancelled:          { bg: '#FEE2E2', text: '#DC2626' },
};

const STATUS_LABELS: Record<POStatus, string> = {
  draft:              'Draft',
  pending_approval:   'Pending',
  approved:           'Approved',
  sent:               'Sent',
  partially_received: 'Part. Received',
  received:           'Received',
  cancelled:          'Cancelled',
};

const STATUS_TABS: Array<{ key: POStatus | 'all'; label: string }> = [
  { key: 'all',            label: 'All' },
  { key: 'draft',          label: 'Draft' },
  { key: 'pending_approval', label: 'Pending' },
  { key: 'approved',       label: 'Approved' },
  { key: 'sent',           label: 'Sent' },
  { key: 'received',       label: 'Received' },
  { key: 'cancelled',      label: 'Cancelled' },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtCur(n: number, sym: string): string {
  return `${sym}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function computeLineTotal(item: { unitPrice: number; orderedQty: number; discount: number; taxPercent: number }): number {
  const base = item.unitPrice * item.orderedQty;
  const net  = Math.max(0, base - item.discount);
  return Math.round((net + net * item.taxPercent / 100) * 100) / 100;
}

function computeTotals(items: { unitPrice: number; orderedQty: number; discount: number; taxPercent: number }[], poDiscount: number, poTax: number, shipping: number) {
  let subtotal = 0, taxTotal = 0;
  for (const item of items) {
    const base = item.unitPrice * item.orderedQty;
    const net  = Math.max(0, base - item.discount);
    subtotal += net;
    taxTotal += net * item.taxPercent / 100;
  }
  subtotal  = Math.round(subtotal * 100) / 100;
  taxTotal  = Math.round(taxTotal * 100) / 100;
  const total = Math.max(0, Math.round((subtotal + taxTotal - poDiscount + poTax + shipping) * 100) / 100);
  return { subtotal, taxTotal, total };
}

// ── PO Row ────────────────────────────────────────────────────────────────────

interface PORowProps {
  po:       PurchaseOrder;
  sym:      string;
  onPress:  () => void;
}

function PORow({ po, sym, onPress }: PORowProps) {
  const s = STATUS_COLORS[po.status];
  return (
    <TouchableOpacity style={styles.poRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.poRowTop}>
        <Text style={styles.poNumber}>{po.poNumber}</Text>
        <View style={[styles.badge, { backgroundColor: s.bg }]}>
          <Text style={[styles.badgeText, { color: s.text }]}>{STATUS_LABELS[po.status]}</Text>
        </View>
      </View>
      <Text style={styles.poVendor} numberOfLines={1}>{po.vendorSnapshot.businessName}</Text>
      <View style={styles.poRowBottom}>
        <Text style={styles.poDate}>{fmtDate(po.orderDate)}</Text>
        <Text style={styles.poItems}>{po.items.length} item{po.items.length !== 1 ? 's' : ''}</Text>
        <Text style={styles.poTotal}>{fmtCur(po.total, sym)}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

interface DetailModalProps {
  po:      PurchaseOrder;
  sym:     string;
  visible: boolean;
  onClose: () => void;
  onEdit:  () => void;
  onChange: (updated: PurchaseOrder) => void;
  onDelete: () => void;
}

function DetailModal({ po, sym, visible, onClose, onEdit, onChange, onDelete }: DetailModalProps) {
  const [acting, setActing]           = useState(false);
  const [showCancelInput, setShowCancelInput] = useState(false);
  const [cancelReason, setCancelReason]       = useState('');

  const canEdit    = po.status === 'draft' || po.status === 'pending_approval';
  const canSubmit  = po.status === 'draft';
  const canApprove = po.status === 'draft' || po.status === 'pending_approval';
  const canSend    = po.status === 'approved';
  const canCancel  = ['draft', 'pending_approval', 'approved', 'sent'].includes(po.status);

  async function doAction(fn: () => Promise<PurchaseOrder>) {
    setActing(true);
    try {
      const updated = await fn();
      onChange(updated);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActing(false);
    }
  }

  function confirmDelete() {
    Alert.alert('Delete PO', `Delete ${po.poNumber}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        api.deletePurchaseOrder(po._id)
          .then(() => { onClose(); onDelete(); })
          .catch(e => Alert.alert('Error', e instanceof Error ? e.message : 'Delete failed'));
      }},
    ]);
  }

  const s = STATUS_COLORS[po.status];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalHeaderCode}>{po.poNumber}</Text>
              <Text style={styles.modalHeaderName}>{po.vendorSnapshot.businessName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Status */}
            <View style={[styles.statusRow, { backgroundColor: s.bg }]}>
              <Text style={[styles.statusRowText, { color: s.text }]}>{STATUS_LABELS[po.status]}</Text>
            </View>

            {/* Financials */}
            <View style={styles.finCards}>
              <View style={styles.finCard}>
                <Text style={styles.finLabel}>Total</Text>
                <Text style={styles.finValue}>{fmtCur(po.total, sym)}</Text>
              </View>
              <View style={styles.finCard}>
                <Text style={styles.finLabel}>Items</Text>
                <Text style={styles.finValue}>{po.items.length}</Text>
              </View>
              <View style={styles.finCard}>
                <Text style={styles.finLabel}>Status</Text>
                <Text style={[styles.finValue, { color: s.text, fontSize: FontSize.sm }]}>{STATUS_LABELS[po.status]}</Text>
              </View>
            </View>

            {/* Meta info */}
            <View style={styles.section}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Order Date</Text>
                <Text style={styles.infoValue}>{fmtDate(po.orderDate)}</Text>
              </View>
              {po.expectedDeliveryDate && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Expected</Text>
                  <Text style={styles.infoValue}>{fmtDate(po.expectedDeliveryDate)}</Text>
                </View>
              )}
              {po.approvedAt && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Approved</Text>
                  <Text style={styles.infoValue}>{fmtDate(po.approvedAt)}</Text>
                </View>
              )}
              {po.approvedBy && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Approved By</Text>
                  <Text style={styles.infoValue}>{po.approvedBy}</Text>
                </View>
              )}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Currency</Text>
                <Text style={styles.infoValue}>{po.currency}</Text>
              </View>
            </View>

            {/* Items */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Items</Text>
              {po.items.map((item, i) => (
                <View key={i} style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.productName}</Text>
                    {item.variantName ? <Text style={styles.itemVariant}>{item.variantName}</Text> : null}
                    <Text style={styles.itemMeta}>
                      {item.orderedQty} {item.unit} × {fmtCur(item.unitPrice, sym)}
                      {item.taxPercent > 0 ? ` + ${item.taxPercent}% tax` : ''}
                    </Text>
                    {item.receivedQty > 0 && (
                      <Text style={styles.receivedText}>Received: {item.receivedQty} {item.unit}</Text>
                    )}
                  </View>
                  <Text style={styles.itemTotal}>{fmtCur(item.lineTotal, sym)}</Text>
                </View>
              ))}
            </View>

            {/* PO Summary */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Summary</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Subtotal</Text>
                <Text style={styles.infoValue}>{fmtCur(po.subtotal, sym)}</Text>
              </View>
              {po.taxTotal > 0 && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Tax</Text>
                  <Text style={styles.infoValue}>{fmtCur(po.taxTotal, sym)}</Text>
                </View>
              )}
              {po.discount > 0 && (
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: '#16A34A' }]}>Discount</Text>
                  <Text style={[styles.infoValue, { color: '#16A34A' }]}>-{fmtCur(po.discount, sym)}</Text>
                </View>
              )}
              {po.shipping > 0 && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Shipping</Text>
                  <Text style={styles.infoValue}>{fmtCur(po.shipping, sym)}</Text>
                </View>
              )}
              <View style={[styles.infoRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{fmtCur(po.total, sym)}</Text>
              </View>
            </View>

            {/* Notes */}
            {!!po.notes && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Notes</Text>
                <Text style={styles.notesText}>{po.notes}</Text>
              </View>
            )}

            {/* Cancel reason */}
            {!!po.cancelReason && (
              <View style={[styles.section, styles.cancelSection]}>
                <Text style={styles.cancelTitle}>Cancelled</Text>
                <Text style={styles.cancelText}>{po.cancelReason}</Text>
              </View>
            )}

            {/* Cancel input */}
            {showCancelInput && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Reason for Cancellation</Text>
                <TextInput
                  value={cancelReason}
                  onChangeText={setCancelReason}
                  placeholder="Enter reason…"
                  placeholderTextColor={Colors.textSecondary}
                  multiline
                  style={styles.cancelInput}
                />
                <View style={styles.actionRow}>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnOutline]} onPress={() => setShowCancelInput(false)}>
                    <Text style={styles.actionBtnOutlineText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: '#EF4444', flex: 1 }]}
                    onPress={() => void doAction(() => api.cancelPurchaseOrder(po._id, cancelReason)).then(() => setShowCancelInput(false))}
                    disabled={acting}
                  >
                    {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Confirm Cancel</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Action bar */}
          {!showCancelInput && (
            <View style={styles.actionBar}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnOutline, { flex: 0, paddingHorizontal: 16 }]}
                onPress={() => void doAction(() => api.duplicatePurchaseOrder(po._id)).then(() => onClose())}
                disabled={acting}
              >
                <MaterialIcons name="content-copy" size={16} color={Colors.textSecondary} />
              </TouchableOpacity>

              {po.status === 'draft' && (
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnOutline, { flex: 0, paddingHorizontal: 16 }]}
                  onPress={confirmDelete} disabled={acting}>
                  <MaterialIcons name="delete-outline" size={16} color="#EF4444" />
                </TouchableOpacity>
              )}

              {canEdit && (
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnOutline, { flex: 1 }]}
                  onPress={onEdit} disabled={acting}>
                  <Text style={styles.actionBtnOutlineText}>Edit</Text>
                </TouchableOpacity>
              )}

              {canSubmit && (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F59E0B', flex: 1 }]}
                  onPress={() => void doAction(() => api.submitPurchaseOrder(po._id))} disabled={acting}>
                  {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Submit</Text>}
                </TouchableOpacity>
              )}

              {canApprove && (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#059669', flex: 1 }]}
                  onPress={() => void doAction(() => api.approvePurchaseOrder(po._id))} disabled={acting}>
                  {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Approve</Text>}
                </TouchableOpacity>
              )}

              {canSend && (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: Colors.primary, flex: 1 }]}
                  onPress={() => void doAction(() => api.sendPurchaseOrder(po._id))} disabled={acting}>
                  {acting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Mark Sent</Text>}
                </TouchableOpacity>
              )}

              {canCancel && (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#EF4444', flex: 0, paddingHorizontal: 16 }]}
                  onPress={() => setShowCancelInput(true)} disabled={acting}>
                  <MaterialIcons name="block" size={16} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Form Modal ────────────────────────────────────────────────────────────────

type FormItem = {
  productName: string;
  variantName: string;
  orderedQty:  string;
  unit:        string;
  unitPrice:   string;
  discount:    string;
  taxPercent:  string;
};

const BLANK_FORM_ITEM: FormItem = {
  productName: '', variantName: '',
  orderedQty: '1', unit: 'pcs',
  unitPrice: '0', discount: '0', taxPercent: '0',
};

interface FormModalProps {
  visible:  boolean;
  editing:  PurchaseOrder | null;
  vendors:  Vendor[];
  onClose:  () => void;
  onSaved:  (po: PurchaseOrder) => void;
}

function FormModal({ visible, editing, vendors, onClose, onSaved }: FormModalProps) {
  const [vendorId, setVendorId]       = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [orderDate, setOrderDate]     = useState(todayISO());
  const [expDelivery, setExpDelivery] = useState('');
  const [currency, setCurrency]       = useState('INR');
  const [notes, setNotes]             = useState('');
  const [items, setItems]             = useState<FormItem[]>([{ ...BLANK_FORM_ITEM }]);
  const [poDiscount, setPoDiscount]   = useState('0');
  const [poTax, setPoTax]             = useState('0');
  const [shipping, setShipping]       = useState('0');
  const [saving, setSaving]           = useState(false);
  const [vendorOpen, setVendorOpen]   = useState(false);
  const [saveAsDraft, setSaveAsDraft] = useState(false);

  useFocusEffect(useCallback(() => {
    if (!visible) return;
    if (editing) {
      const v = vendors.find(x => x._id === editing.vendorId);
      setVendorId(editing.vendorId);
      setVendorSearch(v?.businessName ?? editing.vendorSnapshot.businessName);
      setOrderDate(editing.orderDate?.slice(0, 10) ?? todayISO());
      setExpDelivery(editing.expectedDeliveryDate?.slice(0, 10) ?? '');
      setCurrency(editing.currency || 'INR');
      setNotes(editing.notes ?? '');
      setItems(editing.items.map(i => ({
        productName: i.productName,
        variantName: i.variantName ?? '',
        orderedQty:  String(i.orderedQty),
        unit:        i.unit,
        unitPrice:   String(i.unitPrice),
        discount:    String(i.discount),
        taxPercent:  String(i.taxPercent),
      })));
      setPoDiscount(String(editing.discount));
      setPoTax(String(editing.tax));
      setShipping(String(editing.shipping));
    } else {
      setVendorId(''); setVendorSearch('');
      setOrderDate(todayISO()); setExpDelivery('');
      setCurrency('INR'); setNotes('');
      setItems([{ ...BLANK_FORM_ITEM }]);
      setPoDiscount('0'); setPoTax('0'); setShipping('0');
    }
    setSaving(false);
  }, [visible, editing, vendors]));

  const filteredVendors = vendors.filter(v =>
    v.businessName.toLowerCase().includes(vendorSearch.toLowerCase()) ||
    v.vendorCode.toLowerCase().includes(vendorSearch.toLowerCase()),
  );

  function setItemField(idx: number, key: keyof FormItem, val: string) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [key]: val } : item));
  }

  function addItem() {
    setItems(prev => [...prev, { ...BLANK_FORM_ITEM }]);
  }

  function removeItem(idx: number) {
    if (items.length === 1) return;
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function save(status: 'draft' | 'pending_approval') {
    if (!vendorId) { Alert.alert('Error', 'Please select a vendor'); return; }
    if (items.some(i => !i.productName.trim())) { Alert.alert('Error', 'All items need a product name'); return; }
    setSaving(true);
    try {
      const payload: POInput = {
        vendorId,
        status,
        orderDate:             orderDate || undefined,
        expectedDeliveryDate:  expDelivery || undefined,
        currency,
        notes,
        items: items.map<POItemInput>(i => ({
          productName: i.productName.trim(),
          variantName: i.variantName || undefined,
          orderedQty:  parseFloat(i.orderedQty) || 1,
          unit:        i.unit || 'pcs',
          unitPrice:   parseFloat(i.unitPrice) || 0,
          discount:    parseFloat(i.discount) || 0,
          taxPercent:  parseFloat(i.taxPercent) || 0,
        })),
        discount: parseFloat(poDiscount) || 0,
        tax:      parseFloat(poTax) || 0,
        shipping: parseFloat(shipping) || 0,
      };
      const po = editing
        ? await api.updatePurchaseOrder(editing._id, payload)
        : await api.createPurchaseOrder(payload);
      onSaved(po);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const itemObjects = items.map(i => ({
    unitPrice:  parseFloat(i.unitPrice) || 0,
    orderedQty: parseFloat(i.orderedQty) || 0,
    discount:   parseFloat(i.discount) || 0,
    taxPercent: parseFloat(i.taxPercent) || 0,
  }));
  const { subtotal, taxTotal, total } = computeTotals(
    itemObjects, parseFloat(poDiscount) || 0, parseFloat(poTax) || 0, parseFloat(shipping) || 0,
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{editing ? `Edit ${editing.poNumber}` : 'New Purchase Order'}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled">

            {/* Vendor selector */}
            <Text style={styles.fieldLabel}>Vendor *</Text>
            <TouchableOpacity style={styles.fieldInput} onPress={() => setVendorOpen(true)}>
              <Text style={[styles.fieldText, !vendorId && { color: Colors.textSecondary }]}>
                {vendorSearch || 'Select vendor…'}
              </Text>
              <MaterialIcons name="arrow-drop-down" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>

            {/* Vendor picker */}
            {vendorOpen && (
              <View style={styles.vendorPicker}>
                <TextInput
                  value={vendorSearch}
                  onChangeText={setVendorSearch}
                  placeholder="Search vendor…"
                  placeholderTextColor={Colors.textSecondary}
                  style={styles.vendorSearch}
                  autoFocus
                />
                <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled">
                  {filteredVendors.map(v => (
                    <TouchableOpacity key={v._id} style={styles.vendorPickerItem}
                      onPress={() => { setVendorId(v._id); setVendorSearch(v.businessName); setVendorOpen(false); }}>
                      <Text style={styles.vendorPickerName}>{v.businessName}</Text>
                      <Text style={styles.vendorPickerCode}>{v.vendorCode}</Text>
                    </TouchableOpacity>
                  ))}
                  {filteredVendors.length === 0 && (
                    <Text style={styles.emptyText}>No vendors found</Text>
                  )}
                </ScrollView>
              </View>
            )}

            {/* Dates */}
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Order Date</Text>
                <TextInput value={orderDate} onChangeText={setOrderDate} placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textSecondary} style={styles.fieldInput} />
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.fieldLabel}>Expected Delivery</Text>
                <TextInput value={expDelivery} onChangeText={setExpDelivery} placeholder="YYYY-MM-DD"
                  placeholderTextColor={Colors.textSecondary} style={styles.fieldInput} />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput value={notes} onChangeText={setNotes} placeholder="Notes to vendor…"
              placeholderTextColor={Colors.textSecondary} multiline numberOfLines={2}
              style={[styles.fieldInput, { height: 60, textAlignVertical: 'top' }]} />

            {/* Items */}
            <View style={styles.itemsHeader}>
              <Text style={styles.sectionTitle}>Items</Text>
              <TouchableOpacity onPress={addItem} style={styles.addItemBtn}>
                <MaterialIcons name="add" size={16} color={Colors.primary} />
                <Text style={styles.addItemText}>Add Item</Text>
              </TouchableOpacity>
            </View>

            {items.map((item, idx) => {
              const lt = computeLineTotal({
                unitPrice:  parseFloat(item.unitPrice) || 0,
                orderedQty: parseFloat(item.orderedQty) || 0,
                discount:   parseFloat(item.discount) || 0,
                taxPercent: parseFloat(item.taxPercent) || 0,
              });
              return (
                <View key={idx} style={styles.itemCard}>
                  <View style={styles.itemCardHeader}>
                    <Text style={styles.itemCardNum}>Item {idx + 1}</Text>
                    {items.length > 1 && (
                      <TouchableOpacity onPress={() => removeItem(idx)}>
                        <MaterialIcons name="close" size={16} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    value={item.productName} onChangeText={v => setItemField(idx, 'productName', v)}
                    placeholder="Product name *" placeholderTextColor={Colors.textSecondary}
                    style={[styles.fieldInput, { marginBottom: 6 }]}
                  />
                  <View style={styles.rowFields}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.miniLabel}>Unit</Text>
                      <TextInput value={item.unit} onChangeText={v => setItemField(idx, 'unit', v)}
                        placeholderTextColor={Colors.textSecondary} style={styles.miniInput} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.miniLabel}>Qty</Text>
                      <TextInput value={item.orderedQty} onChangeText={v => setItemField(idx, 'orderedQty', v)}
                        keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} style={styles.miniInput} />
                    </View>
                    <View style={{ flex: 1.5, marginLeft: 8 }}>
                      <Text style={styles.miniLabel}>Price</Text>
                      <TextInput value={item.unitPrice} onChangeText={v => setItemField(idx, 'unitPrice', v)}
                        keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} style={styles.miniInput} />
                    </View>
                  </View>
                  <View style={styles.rowFields}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.miniLabel}>Disc</Text>
                      <TextInput value={item.discount} onChangeText={v => setItemField(idx, 'discount', v)}
                        keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} style={styles.miniInput} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.miniLabel}>Tax%</Text>
                      <TextInput value={item.taxPercent} onChangeText={v => setItemField(idx, 'taxPercent', v)}
                        keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} style={styles.miniInput} />
                    </View>
                    <View style={{ flex: 1.5, marginLeft: 8, justifyContent: 'flex-end', paddingBottom: 2 }}>
                      <Text style={styles.miniLabel}>Line Total</Text>
                      <Text style={styles.lineTotal}>{String(lt)}</Text>
                    </View>
                  </View>
                </View>
              );
            })}

            {/* PO-level adjustments */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Adjustments</Text>
              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.miniLabel}>PO Discount</Text>
                  <TextInput value={poDiscount} onChangeText={setPoDiscount}
                    keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} style={styles.miniInput} />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.miniLabel}>Add. Tax</Text>
                  <TextInput value={poTax} onChangeText={setPoTax}
                    keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} style={styles.miniInput} />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.miniLabel}>Shipping</Text>
                  <TextInput value={shipping} onChangeText={setShipping}
                    keyboardType="decimal-pad" placeholderTextColor={Colors.textSecondary} style={styles.miniInput} />
                </View>
              </View>
            </View>

            {/* Live totals */}
            <View style={styles.totalsBox}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Subtotal</Text>
                <Text style={styles.infoValue}>{String(subtotal)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Tax</Text>
                <Text style={styles.infoValue}>{String(taxTotal)}</Text>
              </View>
              <View style={[styles.infoRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{String(total)}</Text>
              </View>
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.actionBar}>
            <TouchableOpacity onPress={onClose} style={[styles.actionBtn, styles.actionBtnOutline, { flex: 0, paddingHorizontal: 16 }]} disabled={saving}>
              <MaterialIcons name="close" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void save('draft')}
              style={[styles.actionBtn, styles.actionBtnOutline, { flex: 1 }]} disabled={saving}>
              {saving && saveAsDraft
                ? <ActivityIndicator color={Colors.primary} size="small" />
                : <Text style={styles.actionBtnOutlineText}>Save Draft</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setSaveAsDraft(false); void save('pending_approval'); }}
              style={[styles.actionBtn, { backgroundColor: Colors.primary, flex: 1.5 }]}
              disabled={saving}
            >
              {saving && !saveAsDraft
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.actionBtnText}>Submit for Approval</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function PurchaseOrderScreen() {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';

  const [pos, setPOs]               = useState<PurchaseOrder[]>([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]         = useState('');
  const [statusTab, setStatusTab]   = useState<POStatus | 'all'>('all');

  const [vendors, setVendors]       = useState<Vendor[]>([]);

  const [detailPO, setDetailPO]     = useState<PurchaseOrder | null>(null);
  const [formOpen, setFormOpen]     = useState(false);
  const [editingPO, setEditingPO]   = useState<PurchaseOrder | null>(null);

  const loadVendors = useCallback(async () => {
    try {
      const r = await api.getVendors({ limit: 200 });
      setVendors(r.vendors);
    } catch { /* silent */ }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params: Parameters<typeof api.getPurchaseOrders>[0] = { limit: 100 };
      if (statusTab !== 'all') params.status = statusTab;
      if (search.trim()) params.search = search.trim();
      const { purchaseOrders, total: t } = await api.getPurchaseOrders(params);
      setPOs(purchaseOrders); setTotal(t);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [statusTab, search]);

  useFocusEffect(useCallback(() => {
    void load(); void loadVendors();
  }, [load, loadVendors]));

  function onRefresh() {
    setRefreshing(true);
    void load(true);
  }

  function onSaved(po: PurchaseOrder) {
    setPOs(prev => {
      const idx = prev.findIndex(p => p._id === po._id);
      if (idx >= 0) return prev.map(p => p._id === po._id ? po : p);
      return [po, ...prev];
    });
    if (!editingPO) setTotal(t => t + 1);
    setFormOpen(false);
    setEditingPO(null);
    setDetailPO(po);
  }

  function onAction(updated: PurchaseOrder) {
    setPOs(prev => prev.map(p => p._id === updated._id ? updated : p));
    setDetailPO(updated);
  }

  function onDelete() {
    setPOs(prev => prev.filter(p => p._id !== detailPO?._id));
    setTotal(t => t - 1);
    setDetailPO(null);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <MaterialIcons name="search" size={18} color={Colors.textSecondary} style={{ marginRight: 6 }} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => void load()}
            returnKeyType="search"
            placeholder="Search POs…"
            placeholderTextColor={Colors.textSecondary}
            style={styles.searchInput}
          />
          {!!search && (
            <TouchableOpacity onPress={() => { setSearch(''); }}>
              <MaterialIcons name="close" size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.addBtn}
          onPress={() => { setEditingPO(null); setFormOpen(true); }}>
          <MaterialIcons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Status chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}
        contentContainerStyle={{ paddingHorizontal: Spacing.md }}>
        {STATUS_TABS.map(tab => (
          <TouchableOpacity key={tab.key} onPress={() => setStatusTab(tab.key)}
            style={[styles.chip, statusTab === tab.key && styles.chipActive]}>
            <Text style={[styles.chipText, statusTab === tab.key && styles.chipTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Count */}
      <Text style={styles.countText}>{total} purchase order{total !== 1 ? 's' : ''}</Text>

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={pos}
          keyExtractor={p => p._id}
          renderItem={({ item }) => (
            <PORow po={item} sym={sym} onPress={() => setDetailPO(item)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <MaterialIcons name="shopping-bag" size={48} color={Colors.border} />
              <Text style={styles.emptyText}>No purchase orders{statusTab !== 'all' ? ` with status "${STATUS_LABELS[statusTab as POStatus]}"` : ''}</Text>
              <TouchableOpacity style={styles.emptyBtn}
                onPress={() => { setEditingPO(null); setFormOpen(true); }}>
                <Text style={styles.emptyBtnText}>Create First PO</Text>
              </TouchableOpacity>
            </View>
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      )}

      {/* Detail */}
      {detailPO && (
        <DetailModal
          po={detailPO}
          sym={sym}
          visible={!!detailPO}
          onClose={() => setDetailPO(null)}
          onEdit={() => { setEditingPO(detailPO); setFormOpen(true); setDetailPO(null); }}
          onChange={onAction}
          onDelete={onDelete}
        />
      )}

      {/* Form */}
      <FormModal
        visible={formOpen}
        editing={editingPO}
        vendors={vendors}
        onClose={() => { setFormOpen(false); setEditingPO(null); }}
        onSaved={onSaved}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: Colors.background },
  centered:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  searchRow:      { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: 8 },
  searchBox:      {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 10, height: 40,
  },
  searchInput:    { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  addBtn:         {
    width: 40, height: 40, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },

  chipsRow:       { flexGrow: 0 },
  chip:           {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, marginRight: 8,
    backgroundColor: Colors.surface,
  },
  chipActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:       { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: '#fff' },

  countText:      { paddingHorizontal: Spacing.md, paddingTop: 6, fontSize: FontSize.xs, color: Colors.textSecondary },

  poRow:          {
    marginHorizontal: Spacing.md, marginTop: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, padding: 12,
    ...Shadows.sm,
  },
  poRowTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  poNumber:       { fontFamily: 'monospace', fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  poVendor:       { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600', marginBottom: 6 },
  poRowBottom:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  poDate:         { fontSize: FontSize.xs, color: Colors.textSecondary },
  poItems:        { fontSize: FontSize.xs, color: Colors.textSecondary },
  poTotal:        { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },

  badge:          { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText:      { fontSize: 10, fontWeight: '600' },

  emptyText:      { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginTop: 12 },
  emptyBtn:       {
    marginTop: 16, backgroundColor: Colors.primary,
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: BorderRadius.md,
  },
  emptyBtnText:   { color: '#fff', fontSize: FontSize.sm, fontWeight: '600' },

  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader:    {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalHeaderCode: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  modalHeaderName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: 2 },
  modalTitle:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  closeBtn:       { padding: 4 },
  modalBody:      { flex: 1, padding: Spacing.md },
  modalBodyContent: { paddingBottom: 24 },

  statusRow:      { borderRadius: BorderRadius.sm, padding: 8, marginBottom: 12, alignItems: 'center' },
  statusRowText:  { fontSize: FontSize.sm, fontWeight: '700' },

  finCards:       { flexDirection: 'row', gap: 8, marginBottom: 12 },
  finCard:        {
    flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, padding: 10, alignItems: 'center',
  },
  finLabel:       { fontSize: 10, color: Colors.textSecondary, marginBottom: 2 },
  finValue:       { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  section:        { marginTop: 16 },
  sectionTitle:   { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },

  infoRow:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  infoLabel:      { fontSize: FontSize.sm, color: Colors.textSecondary },
  infoValue:      { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500' },
  totalRow:       { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 8, marginTop: 4 },
  totalLabel:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  totalValue:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  itemRow:        { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  itemName:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  itemVariant:    { fontSize: FontSize.xs, color: Colors.textSecondary },
  itemMeta:       { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  receivedText:   { fontSize: FontSize.xs, color: '#16A34A', marginTop: 2 },
  itemTotal:      { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, minWidth: 70, textAlign: 'right' },

  notesText:      { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },

  cancelSection:  { backgroundColor: '#FEE2E2', borderRadius: BorderRadius.sm, padding: 10 },
  cancelTitle:    { fontSize: FontSize.xs, fontWeight: '700', color: '#DC2626', marginBottom: 4 },
  cancelText:     { fontSize: FontSize.sm, color: '#991B1B' },
  cancelInput:    {
    backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FCA5A5',
    borderRadius: BorderRadius.sm, padding: 10, fontSize: FontSize.sm,
    color: Colors.text, minHeight: 60, textAlignVertical: 'top', marginBottom: 8,
  },

  actionBar:      {
    flexDirection: 'row', gap: 8, padding: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  actionRow:      { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn:      {
    height: 44, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12,
  },
  actionBtnText:  { color: '#fff', fontSize: FontSize.sm, fontWeight: '600' },
  actionBtnOutline: { borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  actionBtnOutlineText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500' },

  // Form
  fieldLabel:     { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldInput:     {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: FontSize.sm, color: Colors.text, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  fieldText:      { fontSize: FontSize.sm, color: Colors.text, flex: 1 },
  rowFields:      { flexDirection: 'row', marginBottom: 12 },
  miniLabel:      { fontSize: 10, color: Colors.textSecondary, marginBottom: 3 },
  miniInput:      {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, paddingHorizontal: 8, paddingVertical: 7,
    fontSize: FontSize.xs, color: Colors.text,
  },
  lineTotal:      { fontSize: FontSize.xs, fontWeight: '700', color: Colors.text },

  itemsHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 4 },
  addItemBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addItemText:    { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  itemCard:       {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, padding: 10, marginBottom: 8,
  },
  itemCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  itemCardNum:    { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },

  totalsBox:      {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, padding: 12, marginTop: 8,
  },

  vendorPicker:   {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12, overflow: 'hidden',
  },
  vendorSearch:   {
    padding: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
    fontSize: FontSize.sm, color: Colors.text,
  },
  vendorPickerItem: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  vendorPickerName: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500', flex: 1 },
  vendorPickerCode: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
