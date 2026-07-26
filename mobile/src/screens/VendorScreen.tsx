import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, ScrollView,
  Linking, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';
import type { Vendor } from '../types';
import type { VendorInput } from '../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYMENT_TERMS: Array<{ id: NonNullable<VendorInput['paymentTerms']>; label: string }> = [
  { id: 'immediate', label: 'Immediate' },
  { id: 'net15',     label: 'Net 15' },
  { id: 'net30',     label: 'Net 30' },
  { id: 'net45',     label: 'Net 45' },
  { id: 'net60',     label: 'Net 60' },
  { id: 'custom',    label: 'Custom' },
];

const BLANK: VendorInput = {
  businessName:    '',
  contactPerson:   '',
  mobile:          '',
  alternateMobile: '',
  email:           '',
  gstNumber:       '',
  pan:             '',
  address:         '',
  city:            '',
  state:           '',
  pincode:         '',
  paymentTerms:    'immediate',
  creditLimit:     0,
  openingBalance:  0,
  notes:           '',
  isActive:        true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, sym: string) {
  return `${sym}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function ptLabel(pt: string) {
  return PAYMENT_TERMS.find(t => t.id === pt)?.label ?? pt;
}

// ── Vendor Row ────────────────────────────────────────────────────────────────

function VendorRow({
  vendor, onPress, sym,
}: { vendor: Vendor; onPress: () => void; sym: string }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <View style={[styles.avatar, { backgroundColor: vendor.isActive ? Colors.primary + '22' : Colors.border }]}>
          <MaterialIcons name="store" size={18} color={vendor.isActive ? Colors.primary : Colors.textSecondary} />
        </View>
        <View style={styles.rowInfo}>
          <Text style={styles.rowName} numberOfLines={1}>{vendor.businessName}</Text>
          <Text style={styles.rowCode}>{vendor.vendorCode} · {vendor.mobile}</Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        {vendor.currentOutstanding > 0 && (
          <Text style={styles.rowOutstanding}>{fmt(vendor.currentOutstanding, sym)}</Text>
        )}
        <View style={[styles.badge, { backgroundColor: vendor.isActive ? '#E8F5E9' : '#F5F5F5' }]}>
          <Text style={[styles.badgeText, { color: vendor.isActive ? '#2E7D32' : Colors.textSecondary }]}>
            {vendor.isActive ? 'Active' : 'Off'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Vendor Detail Modal ───────────────────────────────────────────────────────

function DetailModal({
  vendor, sym, onEdit, onDelete, onClose,
}: {
  vendor: Vendor;
  sym: string;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.detailSheet}>
          <View style={styles.sheetHandle} />

          {/* Header */}
          <View style={styles.detailHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailCode}>{vendor.vendorCode}</Text>
              <Text style={styles.detailName}>{vendor.businessName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            {/* Outstanding card */}
            {vendor.currentOutstanding > 0 && (
              <View style={styles.outstandingCard}>
                <Text style={styles.outstandingLabel}>Outstanding</Text>
                <Text style={styles.outstandingValue}>{fmt(vendor.currentOutstanding, sym)}</Text>
                {vendor.creditLimit > 0 && (
                  <Text style={styles.outstandingLimit}>of {fmt(vendor.creditLimit, sym)} limit</Text>
                )}
              </View>
            )}

            {/* Contact actions */}
            <View style={styles.contactRow}>
              <TouchableOpacity
                style={styles.contactBtn}
                onPress={() => Linking.openURL(`tel:${vendor.mobile}`)}
              >
                <MaterialIcons name="call" size={20} color="#1565C0" />
                <Text style={[styles.contactBtnText, { color: '#1565C0' }]}>Call</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.contactBtn}
                onPress={() => Linking.openURL(`https://wa.me/91${vendor.mobile.replace(/\D/g, '')}`)}
              >
                <MaterialIcons name="chat" size={20} color="#2E7D32" />
                <Text style={[styles.contactBtnText, { color: '#2E7D32' }]}>WhatsApp</Text>
              </TouchableOpacity>
              {vendor.email ? (
                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => Linking.openURL(`mailto:${vendor.email}`)}
                >
                  <MaterialIcons name="email" size={20} color="#6A1B9A" />
                  <Text style={[styles.contactBtnText, { color: '#6A1B9A' }]}>Email</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Info rows */}
            <View style={styles.infoSection}>
              {vendor.contactPerson ? (
                <InfoRow icon="person" label="Contact" value={vendor.contactPerson} />
              ) : null}
              {vendor.alternateMobile ? (
                <InfoRow icon="phone" label="Alt Mobile" value={vendor.alternateMobile} />
              ) : null}
              {vendor.gstNumber ? (
                <InfoRow icon="business" label="GST" value={vendor.gstNumber} />
              ) : null}
              {vendor.pan ? (
                <InfoRow icon="credit-card" label="PAN" value={vendor.pan} />
              ) : null}
              {(vendor.city || vendor.state) ? (
                <InfoRow
                  icon="location-on"
                  label="Location"
                  value={[vendor.city, vendor.state, vendor.pincode].filter(Boolean).join(', ')}
                />
              ) : null}
              {vendor.address ? (
                <InfoRow icon="home" label="Address" value={vendor.address} />
              ) : null}
              <InfoRow icon="schedule" label="Payment Terms" value={ptLabel(vendor.paymentTerms)} />
              <InfoRow icon="account-balance-wallet" label="Credit Limit"
                value={vendor.creditLimit > 0 ? fmt(vendor.creditLimit, sym) : '—'} />
              <InfoRow icon="account-balance-wallet" label="Opening Bal."
                value={fmt(vendor.openingBalance, sym)} />
              {vendor.notes ? (
                <InfoRow icon="note" label="Notes" value={vendor.notes} />
              ) : null}
            </View>
          </ScrollView>

          {/* Actions */}
          <View style={styles.detailActions}>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: '#EF5350', borderWidth: 1 }]}
              onPress={onDelete}
            >
              <MaterialIcons name="delete" size={16} color="#EF5350" />
              <Text style={[styles.actionBtnText, { color: '#EF5350' }]}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: Colors.primary, flex: 1 }]}
              onPress={onEdit}
            >
              <MaterialIcons name="edit" size={16} color="#fff" />
              <Text style={[styles.actionBtnText, { color: '#fff' }]}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <MaterialIcons name={icon as any} size={14} color={Colors.textSecondary} style={{ marginRight: 6, marginTop: 1 }} />
      <Text style={styles.infoLabel}>{label}: </Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ── Form Modal ────────────────────────────────────────────────────────────────

function FormModal({
  visible, editing, form, saving, error, onClose, onSave, onChange,
}: {
  visible:  boolean;
  editing:  Vendor | null;
  form:     VendorInput;
  saving:   boolean;
  error:    string | null;
  onClose:  () => void;
  onSave:   () => void;
  onChange: (k: keyof VendorInput, v: string | number | boolean) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.formSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>{editing ? 'Edit Vendor' : 'New Vendor'}</Text>
            <TouchableOpacity onPress={onClose} disabled={saving}>
              <MaterialIcons name="close" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {error ? (
            <View style={styles.errorBanner}>
              <MaterialIcons name="error-outline" size={14} color="#C62828" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <SectionLabel>Business Info</SectionLabel>
            <FField label="Business Name *">
              <TextInput
                style={styles.input}
                value={form.businessName}
                onChangeText={v => onChange('businessName', v)}
                placeholder="e.g. Fresh Vegetables Co."
                placeholderTextColor={Colors.textSecondary}
              />
            </FField>
            <FField label="Contact Person">
              <TextInput
                style={styles.input}
                value={form.contactPerson ?? ''}
                onChangeText={v => onChange('contactPerson', v)}
                placeholder="Name"
                placeholderTextColor={Colors.textSecondary}
              />
            </FField>
            <FField label="Mobile *">
              <TextInput
                style={styles.input}
                value={form.mobile}
                onChangeText={v => onChange('mobile', v)}
                placeholder="10-digit mobile"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="phone-pad"
              />
            </FField>
            <FField label="Alternate Mobile">
              <TextInput
                style={styles.input}
                value={form.alternateMobile ?? ''}
                onChangeText={v => onChange('alternateMobile', v)}
                placeholder="Optional"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="phone-pad"
              />
            </FField>
            <FField label="Email">
              <TextInput
                style={styles.input}
                value={form.email ?? ''}
                onChangeText={v => onChange('email', v)}
                placeholder="vendor@example.com"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </FField>
            <FField label="GST Number">
              <TextInput
                style={styles.input}
                value={form.gstNumber ?? ''}
                onChangeText={v => onChange('gstNumber', v.toUpperCase())}
                placeholder="22AAAAA0000A1Z5"
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="characters"
              />
            </FField>
            <FField label="PAN">
              <TextInput
                style={styles.input}
                value={form.pan ?? ''}
                onChangeText={v => onChange('pan', v.toUpperCase())}
                placeholder="ABCDE1234F"
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="characters"
              />
            </FField>

            <SectionLabel>Address</SectionLabel>
            <FField label="Street Address">
              <TextInput
                style={styles.input}
                value={form.address ?? ''}
                onChangeText={v => onChange('address', v)}
                placeholder="Street address"
                placeholderTextColor={Colors.textSecondary}
              />
            </FField>
            <FField label="City">
              <TextInput
                style={styles.input}
                value={form.city ?? ''}
                onChangeText={v => onChange('city', v)}
                placeholder="City"
                placeholderTextColor={Colors.textSecondary}
              />
            </FField>
            <FField label="State">
              <TextInput
                style={styles.input}
                value={form.state ?? ''}
                onChangeText={v => onChange('state', v)}
                placeholder="State"
                placeholderTextColor={Colors.textSecondary}
              />
            </FField>
            <FField label="Pincode">
              <TextInput
                style={styles.input}
                value={form.pincode ?? ''}
                onChangeText={v => onChange('pincode', v)}
                placeholder="6 digits"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="number-pad"
              />
            </FField>

            <SectionLabel>Financial</SectionLabel>
            <FField label="Payment Terms">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 4 }}>
                  {PAYMENT_TERMS.map(t => (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => onChange('paymentTerms', t.id)}
                      style={[
                        styles.termChip,
                        form.paymentTerms === t.id && styles.termChipActive,
                      ]}
                    >
                      <Text style={[
                        styles.termChipText,
                        form.paymentTerms === t.id && styles.termChipTextActive,
                      ]}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </FField>
            <FField label="Credit Limit">
              <TextInput
                style={styles.input}
                value={String(form.creditLimit ?? 0)}
                onChangeText={v => onChange('creditLimit', parseFloat(v) || 0)}
                keyboardType="decimal-pad"
                placeholderTextColor={Colors.textSecondary}
              />
            </FField>
            <FField label="Opening Balance">
              <TextInput
                style={styles.input}
                value={String(form.openingBalance ?? 0)}
                onChangeText={v => onChange('openingBalance', parseFloat(v) || 0)}
                keyboardType="decimal-pad"
                placeholderTextColor={Colors.textSecondary}
              />
            </FField>
            <FField label="Notes">
              <TextInput
                style={[styles.input, { minHeight: 56 }]}
                value={form.notes ?? ''}
                onChangeText={v => onChange('notes', v)}
                placeholder="Internal notes…"
                placeholderTextColor={Colors.textSecondary}
                multiline
                textAlignVertical="top"
              />
            </FField>

            <FField label="Status">
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([true, false] as const).map(v => (
                  <TouchableOpacity
                    key={String(v)}
                    onPress={() => onChange('isActive', v)}
                    style={[styles.termChip, form.isActive === v && styles.termChipActive]}
                  >
                    <Text style={[styles.termChipText, form.isActive === v && styles.termChipTextActive]}>
                      {v ? 'Active' : 'Inactive'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </FField>

            <View style={{ height: 24 }} />
          </ScrollView>

          <View style={styles.formActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={onSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>{editing ? 'Save Changes' : 'Create Vendor'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function FField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

const VendorScreen: React.FC = () => {
  const { settings } = useSettings();
  const { bottom }   = useSafeAreaInsets();
  const sym = settings.currencySymbol || '₹';

  const [vendors, setVendors]   = useState<Vendor[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]     = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);
  const [formVisible, setFormVisible]   = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [form, setForm]         = useState<VendorInput>(BLANK);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const params: Parameters<typeof api.getVendors>[0] = { limit: 200 };
      if (search.trim()) params.search = search.trim();
      if (activeFilter !== 'all') params.active = activeFilter === 'active' ? 'true' : 'false';
      const { vendors: vs, total: t } = await api.getVendors(params);
      setVendors(vs);
      setTotal(t);
    } catch {
      Alert.alert('Error', 'Failed to load vendors');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, activeFilter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function openCreate() {
    setEditingVendor(null);
    setForm(BLANK);
    setFormError(null);
    setDetailVendor(null);
    setFormVisible(true);
  }

  function openEdit(v: Vendor) {
    setEditingVendor(v);
    setForm({
      businessName:    v.businessName,
      contactPerson:   v.contactPerson,
      mobile:          v.mobile,
      alternateMobile: v.alternateMobile,
      email:           v.email,
      gstNumber:       v.gstNumber,
      pan:             v.pan,
      address:         v.address,
      city:            v.city,
      state:           v.state,
      pincode:         v.pincode,
      paymentTerms:    v.paymentTerms,
      creditLimit:     v.creditLimit,
      openingBalance:  v.openingBalance,
      notes:           v.notes,
      isActive:        v.isActive,
    });
    setFormError(null);
    setDetailVendor(null);
    setFormVisible(true);
  }

  async function handleSave() {
    if (!form.businessName.trim()) { setFormError('Business name is required'); return; }
    if (!form.mobile.trim())       { setFormError('Mobile number is required'); return; }
    setSaving(true);
    setFormError(null);
    try {
      if (editingVendor) {
        const updated = await api.updateVendor(editingVendor._id, form);
        setVendors(vs => vs.map(v => v._id === updated._id ? updated : v));
      } else {
        const created = await api.createVendor(form);
        setVendors(vs => [created, ...vs]);
        setTotal(t => t + 1);
      }
      setFormVisible(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(v: Vendor) {
    Alert.alert(
      'Delete Vendor',
      `Remove "${v.businessName}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteVendor(v._id);
              setVendors(vs => vs.filter(x => x._id !== v._id));
              setTotal(t => t - 1);
              setDetailVendor(null);
            } catch {
              Alert.alert('Error', 'Delete failed');
            }
          },
        },
      ],
    );
  }

  const setField = (k: keyof VendorInput, v: string | number | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  return (
    <View style={[styles.container, { paddingBottom: bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vendors</Text>
        <Text style={styles.headerCount}>{total}</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
          <MaterialIcons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <MaterialIcons name="search" size={18} color={Colors.textSecondary} style={{ marginRight: 6 }} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => load()}
          placeholder="Search vendors…"
          placeholderTextColor={Colors.textSecondary}
          returnKeyType="search"
        />
        {search !== '' && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <MaterialIcons name="close" size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {(['all', 'active', 'inactive'] as const).map(f => (
          <TouchableOpacity
            key={f}
            onPress={() => setActiveFilter(f)}
            style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
          >
            <Text style={[styles.filterChipText, activeFilter === f && styles.filterChipTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : vendors.length === 0 ? (
        <View style={styles.center}>
          <MaterialIcons name="store" size={48} color={Colors.border} />
          <Text style={styles.emptyText}>
            {search ? 'No vendors match your search' : 'No vendors yet'}
          </Text>
          {!search && (
            <TouchableOpacity style={styles.emptyBtn} onPress={openCreate}>
              <Text style={styles.emptyBtnText}>Add First Vendor</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={vendors}
          keyExtractor={v => v._id}
          renderItem={({ item }) => (
            <VendorRow vendor={item} sym={sym} onPress={() => setDetailVendor(item)} />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />
          }
          contentContainerStyle={{ paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Detail modal */}
      {detailVendor && (
        <DetailModal
          vendor={detailVendor}
          sym={sym}
          onEdit={() => openEdit(detailVendor)}
          onDelete={() => confirmDelete(detailVendor)}
          onClose={() => setDetailVendor(null)}
        />
      )}

      {/* Form modal */}
      <FormModal
        visible={formVisible}
        editing={editingVendor}
        form={form}
        saving={saving}
        error={formError}
        onClose={() => setFormVisible(false)}
        onSave={() => { void handleSave(); }}
        onChange={setField}
      />
    </View>
  );
};

export default VendorScreen;

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    ...Shadows.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  headerCount: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginRight: Spacing.sm,
  },
  addBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: 6,
  },
  searchBar: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    paddingVertical: 0,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  emptyText: {
    marginTop: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  emptyBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  emptyBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: FontSize.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.xs,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: {
    flex: 1,
  },
  rowName: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  rowCode: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  rowOutstanding: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: '#E65100',
    fontVariant: ['tabular-nums'],
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  // Detail modal
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  detailSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  formSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    flex: 1,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  detailCode: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
  },
  detailName: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  outstandingCard: {
    margin: Spacing.md,
    backgroundColor: '#FFF3E0',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: '#FFB74D',
  },
  outstandingLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: '#E65100',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  outstandingValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#E65100',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  outstandingLimit: {
    fontSize: FontSize.xs,
    color: '#F57C00',
    marginTop: 2,
  },
  contactRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 10,
  },
  contactBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  contactBtnText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  infoSection: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '600',
    minWidth: 100,
  },
  infoValue: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.text,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.md,
  },
  actionBtnText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  // Form
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  formTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    backgroundColor: '#FFEBEE',
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: '#EF9A9A',
  },
  errorText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: '#C62828',
  },
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: Spacing.md,
    marginBottom: 2,
    marginHorizontal: Spacing.md,
  },
  field: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
  },
  fieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 10 : 7,
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  termChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  termChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  termChipText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  termChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  saveBtn: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
  },
  saveBtnText: {
    fontSize: FontSize.sm,
    color: '#fff',
    fontWeight: '700',
  },
});
