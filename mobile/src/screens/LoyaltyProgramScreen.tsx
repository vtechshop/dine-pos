import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { LoyaltyConfig, LoyaltyCustomer, LoyaltyTransaction } from '../types';

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtTime = (s: string) =>
  new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

const TX_ICONS: Record<LoyaltyTransaction['type'], string> = {
  earn:   '+',
  redeem: '−',
  manual: '~',
  expire: '−',
};

const TX_COLORS: Record<LoyaltyTransaction['type'], string> = {
  earn:   Colors.success,
  redeem: Colors.info,
  manual: Colors.warning,
  expire: Colors.danger,
};

const LoyaltyProgramScreen: React.FC = () => {
  const navigation = useNavigation();
  const { bottom, top } = useSafeAreaInsets();

  const [config, setConfig]           = useState<LoyaltyConfig | null>(null);
  const [customers, setCustomers]     = useState<LoyaltyCustomer[]>([]);
  const [total, setTotal]             = useState(0);
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(false);
  const [configLoading, setConfigLoading] = useState(true);

  // Detail modal
  const [detailCustomer, setDetailCustomer] = useState<LoyaltyCustomer | null>(null);
  const [transactions, setTransactions]     = useState<LoyaltyTransaction[]>([]);
  const [txLoading, setTxLoading]           = useState(false);
  const [showDetail, setShowDetail]         = useState(false);

  // Adjust modal
  const [showAdjust, setShowAdjust]   = useState(false);
  const [adjPoints, setAdjPoints]     = useState('');
  const [adjRemarks, setAdjRemarks]   = useState('');
  const [adjusting, setAdjusting]     = useState(false);

  // Edit config modal
  const [showEditConfig, setShowEditConfig] = useState(false);
  const [editConfigSaving, setEditConfigSaving] = useState(false);
  const [editConfigForm, setEditConfigForm] = useState({
    rewardName: '',
    pointsPerHundredRupees: '',
    minimumRedeemPoints: '',
    maximumRedeemPercent: '',
    pointValueInPaisa: '',
    expiryDays: '',
    roundingRule: 'floor' as LoyaltyConfig['roundingRule'],
    calculationBase: 'grandTotal' as LoyaltyConfig['calculationBase'],
  });

  const loadConfig = useCallback(async () => {
    try {
      const { config: c } = await api.getLoyaltyConfig();
      setConfig(c);
    } catch {
      Alert.alert('Error', 'Failed to load loyalty configuration');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const searchCustomers = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = q.replace(/\D/g, '').length >= 6
        ? { phone: q }
        : q.trim().length >= 2
        ? { name: q.trim() }
        : {};
      const { customers: c, total: t } = await api.getLoyaltyCustomers(params);
      setCustomers(c);
      setTotal(t);
    } catch {
      Alert.alert('Error', 'Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchCustomers(search), 350);
    return () => clearTimeout(t);
  }, [search, searchCustomers]);

  const openDetail = async (c: LoyaltyCustomer) => {
    setDetailCustomer(c);
    setShowDetail(true);
    setTxLoading(true);
    try {
      const { transactions: txs } = await api.getLoyaltyCustomerTransactions(c._id);
      setTransactions(txs);
    } catch {
      Alert.alert('Error', 'Failed to load transactions');
    } finally {
      setTxLoading(false);
    }
  };

  const handleAdjust = async () => {
    if (!detailCustomer) return;
    const pts = parseInt(adjPoints);
    if (!pts || pts === 0) { Alert.alert('Error', 'Enter a non-zero points value'); return; }
    if (!adjRemarks.trim())  { Alert.alert('Error', 'Remarks are required for audit trail'); return; }
    setAdjusting(true);
    try {
      const { customer: updated } = await api.adjustLoyaltyPoints(detailCustomer._id, pts, adjRemarks.trim());
      setDetailCustomer(updated);
      setCustomers(prev => prev.map(c => c._id === updated._id ? updated : c));
      const { transactions: txs } = await api.getLoyaltyCustomerTransactions(detailCustomer._id);
      setTransactions(txs);
      setShowAdjust(false);
      setAdjPoints('');
      setAdjRemarks('');
      Alert.alert('Done', `${pts > 0 ? '+' : ''}${pts} points applied`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Adjustment failed');
    } finally {
      setAdjusting(false);
    }
  };

  const handleSaveConfig = async () => {
    const f = editConfigForm;
    if (!f.rewardName.trim()) { Alert.alert('Error', 'Reward name is required'); return; }
    const pph = parseFloat(f.pointsPerHundredRupees);
    const minPts = parseInt(f.minimumRedeemPoints);
    const maxPct = parseFloat(f.maximumRedeemPercent);
    const ptVal = parseFloat(f.pointValueInPaisa);
    if (!pph || pph <= 0) { Alert.alert('Error', 'Points per ₹100 must be positive'); return; }
    if (!minPts || minPts < 0) { Alert.alert('Error', 'Minimum redeem points must be ≥ 0'); return; }
    if (!maxPct || maxPct <= 0 || maxPct > 100) { Alert.alert('Error', 'Max redeem % must be 1–100'); return; }
    if (!ptVal || ptVal <= 0) { Alert.alert('Error', 'Point value must be positive'); return; }
    setEditConfigSaving(true);
    try {
      const { config: updated } = await api.updateLoyaltyConfig({
        rewardName: f.rewardName.trim(),
        pointsPerHundredRupees: pph,
        minimumRedeemPoints: minPts,
        maximumRedeemPercent: maxPct,
        pointValueInPaisa: Math.round(ptVal * 100),
        expiryDays: f.expiryDays ? parseInt(f.expiryDays) : null,
        roundingRule: f.roundingRule,
        calculationBase: f.calculationBase,
      });
      setConfig(updated);
      setShowEditConfig(false);
      Alert.alert('Saved', 'Loyalty settings updated');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally {
      setEditConfigSaving(false);
    }
  };

  const renderCustomer = ({ item }: { item: LoyaltyCustomer }) => (
    <TouchableOpacity style={styles.custCard} onPress={() => openDetail(item)} activeOpacity={0.82}>
      <View style={styles.custAvatar}>
        <Text style={styles.custInitial}>{(item.name || '?')[0].toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.custName}>{item.name}</Text>
        <Text style={styles.custPhone}>{item.phone}</Text>
        <Text style={styles.custMeta}>{item.visitCount} visits  ·  ₹{item.lifetimeSpend.toFixed(0)} spent</Text>
      </View>
      <View style={styles.pointsBadge}>
        <Text style={styles.pointsNum}>{item.loyaltyBalance}</Text>
        <Text style={styles.pointsLabel}>pts</Text>
      </View>
    </TouchableOpacity>
  );

  const renderTx = ({ item }: { item: LoyaltyTransaction }) => {
    const color = TX_COLORS[item.type];
    return (
      <View style={styles.txRow}>
        <View style={[styles.txIcon, { backgroundColor: color + '20' }]}>
          <Text style={[styles.txIconText, { color }]}>{TX_ICONS[item.type]}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.txType}>{item.type.charAt(0).toUpperCase() + item.type.slice(1)}</Text>
          {item.orderNumber ? <Text style={styles.txSub}>{item.orderNumber}</Text> : null}
          {item.remarks ? <Text style={styles.txSub}>{item.remarks}</Text> : null}
          <Text style={styles.txDate}>{fmtDate(item.createdAt)}  ·  {fmtTime(item.createdAt)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.txPoints, { color }]}>
            {item.points > 0 ? '+' : ''}{item.points}
          </Text>
          <Text style={styles.txBalance}>{item.balance} pts</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: top + Spacing.sm }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => (navigation as any).goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Loyalty Program</Text>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (config) {
              setEditConfigForm({
                rewardName: config.rewardName,
                pointsPerHundredRupees: String(config.pointsPerHundredRupees),
                minimumRedeemPoints: String(config.minimumRedeemPoints),
                maximumRedeemPercent: String(config.maximumRedeemPercent),
                pointValueInPaisa: String((config.pointValueInPaisa / 100).toFixed(2)),
                expiryDays: config.expiryDays != null ? String(config.expiryDays) : '',
                roundingRule: config.roundingRule,
                calculationBase: config.calculationBase,
              });
            }
            setShowEditConfig(true);
          }}
        >
          <MaterialIcons name="settings" size={22} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Config strip */}
      {!configLoading && config && (
        <View style={styles.configStrip}>
          <View style={styles.configItem}>
            <Text style={styles.configVal}>{config.pointsPerHundredRupees}</Text>
            <Text style={styles.configKey}>pts / ₹100</Text>
          </View>
          <View style={styles.configDivider} />
          <View style={styles.configItem}>
            <Text style={styles.configVal}>{config.minimumRedeemPoints}</Text>
            <Text style={styles.configKey}>min redeem</Text>
          </View>
          <View style={styles.configDivider} />
          <View style={styles.configItem}>
            <Text style={styles.configVal}>{(config.pointValueInPaisa / 100).toFixed(2)}</Text>
            <Text style={styles.configKey}>₹ / point</Text>
          </View>
          <View style={styles.configDivider} />
          <View style={styles.configItem}>
            <Text style={styles.configVal}>{config.rewardName || 'Points'}</Text>
            <Text style={styles.configKey}>reward name</Text>
          </View>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchRow}>
        <MaterialIcons name="search" size={20} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or phone..."
          placeholderTextColor={Colors.textMuted}
          clearButtonMode="while-editing"
        />
        {loading && <ActivityIndicator size="small" color={Colors.primary} />}
      </View>

      {customers.length > 0 && (
        <Text style={styles.resultCount}>{total} customer{total !== 1 ? 's' : ''}</Text>
      )}

      <FlatList
        data={customers}
        renderItem={renderCustomer}
        keyExtractor={c => c._id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyWrap}>
              <MaterialIcons name="loyalty" size={52} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>
                {search.length >= 2 ? 'No customers found' : 'Search customers'}
              </Text>
              <Text style={styles.emptySub}>
                {search.length >= 2
                  ? 'Try a different name or phone number'
                  : 'Type a name (2+ chars) or phone number (6+ digits)'}
              </Text>
            </View>
          ) : null
        }
      />

      {/* Customer Detail Modal */}
      <Modal visible={showDetail} transparent animationType="slide" onRequestClose={() => setShowDetail(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: bottom + Spacing.xl }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>{detailCustomer?.name}</Text>
                <Text style={styles.sheetSub}>{detailCustomer?.phone}  ·  {detailCustomer?.customerId}</Text>
              </View>
              <View style={styles.balanceBadge}>
                <Text style={styles.balanceNum}>{detailCustomer?.loyaltyBalance ?? 0}</Text>
                <Text style={styles.balancePts}>points</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.adjustBtn}
              onPress={() => { setShowAdjust(true); setAdjPoints(''); setAdjRemarks(''); }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="tune" size={18} color={Colors.white} />
              <Text style={styles.adjustBtnText}>Adjust Points</Text>
            </TouchableOpacity>

            <Text style={styles.txHeader}>Transaction History</Text>

            {txLoading ? (
              <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: Spacing.xl }} />
            ) : (
              <FlatList
                data={transactions}
                renderItem={renderTx}
                keyExtractor={t => t._id}
                style={{ maxHeight: 320 }}
                ListEmptyComponent={
                  <Text style={styles.txEmpty}>No transactions yet</Text>
                }
              />
            )}

            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowDetail(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Edit Config Modal */}
      <Modal visible={showEditConfig} transparent animationType="slide" onRequestClose={() => setShowEditConfig(false)}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { paddingBottom: bottom + Spacing.xl, maxHeight: '88%' }]}>
            <View style={styles.handle} />
            <Text style={[styles.sheetTitle, { marginBottom: 2 }]}>Loyalty Settings</Text>
            <Text style={[styles.sheetSub, { marginBottom: Spacing.lg }]}>Program configuration</Text>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.adjLabel}>Reward Name</Text>
              <TextInput
                style={[styles.adjInput, { fontSize: FontSize.md }]}
                value={editConfigForm.rewardName}
                onChangeText={v => setEditConfigForm(p => ({ ...p, rewardName: v }))}
                placeholder="e.g. Points"
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.adjLabel}>Points per ₹100 Spend</Text>
              <TextInput
                style={[styles.adjInput, { fontSize: FontSize.md }]}
                value={editConfigForm.pointsPerHundredRupees}
                onChangeText={v => setEditConfigForm(p => ({ ...p, pointsPerHundredRupees: v.replace(/[^0-9.]/g, '') }))}
                keyboardType="decimal-pad"
                placeholder="e.g. 5"
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.adjLabel}>Minimum Redeem Points</Text>
              <TextInput
                style={[styles.adjInput, { fontSize: FontSize.md }]}
                value={editConfigForm.minimumRedeemPoints}
                onChangeText={v => setEditConfigForm(p => ({ ...p, minimumRedeemPoints: v.replace(/[^0-9]/g, '') }))}
                keyboardType="number-pad"
                placeholder="e.g. 100"
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.adjLabel}>Maximum Redeem % of Bill</Text>
              <TextInput
                style={[styles.adjInput, { fontSize: FontSize.md }]}
                value={editConfigForm.maximumRedeemPercent}
                onChangeText={v => setEditConfigForm(p => ({ ...p, maximumRedeemPercent: v.replace(/[^0-9.]/g, '') }))}
                keyboardType="decimal-pad"
                placeholder="e.g. 20"
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.adjLabel}>Point Value (₹ per point)</Text>
              <TextInput
                style={[styles.adjInput, { fontSize: FontSize.md }]}
                value={editConfigForm.pointValueInPaisa}
                onChangeText={v => setEditConfigForm(p => ({ ...p, pointValueInPaisa: v.replace(/[^0-9.]/g, '') }))}
                keyboardType="decimal-pad"
                placeholder="e.g. 0.25"
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.adjLabel}>Points Expiry (days, empty = never)</Text>
              <TextInput
                style={[styles.adjInput, { fontSize: FontSize.md }]}
                value={editConfigForm.expiryDays}
                onChangeText={v => setEditConfigForm(p => ({ ...p, expiryDays: v.replace(/[^0-9]/g, '') }))}
                keyboardType="number-pad"
                placeholder="Leave empty for no expiry"
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.adjLabel}>Points Rounding</Text>
              <View style={styles.toggleRow}>
                {(['floor', 'ceil', 'round'] as LoyaltyConfig['roundingRule'][]).map(opt => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.togglePill, editConfigForm.roundingRule === opt && styles.togglePillActive]}
                    onPress={() => setEditConfigForm(p => ({ ...p, roundingRule: opt }))}
                  >
                    <Text style={[styles.togglePillText, editConfigForm.roundingRule === opt && styles.togglePillTextActive]}>
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.adjLabel, { marginTop: Spacing.sm }]}>Calculation Base</Text>
              <View style={[styles.toggleRow, { marginBottom: Spacing.xxl }]}>
                {([
                  { value: 'subtotal' as const, label: 'Subtotal (excl. GST)' },
                  { value: 'grandTotal' as const, label: 'Grand Total (incl. GST)' },
                ]).map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.togglePill, editConfigForm.calculationBase === opt.value && styles.togglePillActive]}
                    onPress={() => setEditConfigForm(p => ({ ...p, calculationBase: opt.value }))}
                  >
                    <Text style={[styles.togglePillText, editConfigForm.calculationBase === opt.value && styles.togglePillTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <View style={[styles.adjActions, { marginTop: Spacing.md }]}>
              <TouchableOpacity style={styles.adjCancel} onPress={() => setShowEditConfig(false)}>
                <Text style={styles.adjCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adjConfirm, editConfigSaving && { opacity: 0.6 }]}
                onPress={handleSaveConfig}
                disabled={editConfigSaving}
              >
                {editConfigSaving
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.adjConfirmText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Adjust Points Modal */}
      <Modal visible={showAdjust} transparent animationType="fade" onRequestClose={() => setShowAdjust(false)}>
        <View style={styles.adjOverlay}>
          <View style={styles.adjSheet}>
            <Text style={styles.adjTitle}>Adjust Points</Text>
            <Text style={styles.adjSub}>
              {detailCustomer?.name}  ·  Current: {detailCustomer?.loyaltyBalance ?? 0} pts
            </Text>

            <Text style={styles.adjLabel}>Points (positive = add, negative = deduct)</Text>
            <TextInput
              style={styles.adjInput}
              value={adjPoints}
              onChangeText={v => setAdjPoints(v.replace(/[^0-9\-]/g, ''))}
              keyboardType="numbers-and-punctuation"
              placeholder="e.g. 50 or -20"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />

            <Text style={styles.adjLabel}>Remarks (required)</Text>
            <TextInput
              style={[styles.adjInput, { minHeight: 64, textAlignVertical: 'top' }]}
              value={adjRemarks}
              onChangeText={setAdjRemarks}
              placeholder="Reason for adjustment..."
              placeholderTextColor={Colors.textMuted}
              multiline
            />

            <View style={styles.adjActions}>
              <TouchableOpacity style={styles.adjCancel} onPress={() => setShowAdjust(false)}>
                <Text style={styles.adjCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.adjConfirm, adjusting && { opacity: 0.6 }]}
                onPress={handleAdjust}
                disabled={adjusting}
              >
                {adjusting
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.adjConfirmText}>Apply</Text>}
              </TouchableOpacity>
            </View>
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
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn:     { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },

  configStrip: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  configItem:   { flex: 1, alignItems: 'center' },
  configVal:    { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  configKey:    { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  configDivider:{ width: 1, backgroundColor: Colors.border, marginVertical: 4 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  searchInput: { flex: 1, fontSize: FontSize.md, color: Colors.text, paddingVertical: 4 },
  resultCount: { fontSize: FontSize.sm, color: Colors.textMuted, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },

  list: { padding: Spacing.lg, paddingBottom: 32 },
  custCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  custAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  custInitial: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary },
  custName:    { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  custPhone:   { fontSize: FontSize.sm, color: Colors.info },
  custMeta:    { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  pointsBadge: { alignItems: 'center', backgroundColor: Colors.successBg, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.success + '40' },
  pointsNum:   { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.success, lineHeight: 28 },
  pointsLabel: { fontSize: FontSize.xs, color: Colors.success, fontWeight: '700' },

  emptyWrap:   { alignItems: 'center', paddingTop: 60, gap: Spacing.md },
  emptyTitle:  { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub:    { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', paddingHorizontal: Spacing.xxl },

  // Customer detail sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.lg },
  sheetTitle:  { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  sheetSub:    { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },
  balanceBadge:{ alignItems: 'center', backgroundColor: Colors.successBg, borderRadius: BorderRadius.xl, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: Colors.success + '40' },
  balanceNum:  { fontSize: 32, fontWeight: '900', color: Colors.success, lineHeight: 36 },
  balancePts:  { fontSize: FontSize.xs, color: Colors.success, fontWeight: '700' },
  adjustBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg,
    paddingVertical: 12, marginBottom: Spacing.lg, ...Shadows.primary,
  },
  adjustBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },
  txHeader: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  txEmpty:  { color: Colors.textMuted, textAlign: 'center', paddingVertical: Spacing.xl },
  txRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  txIcon:   { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  txIconText: { fontSize: FontSize.xl, fontWeight: '800', lineHeight: 28 },
  txType:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  txSub:    { fontSize: FontSize.xs, color: Colors.textMuted },
  txDate:   { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  txPoints: { fontSize: FontSize.lg, fontWeight: '800' },
  txBalance:{ fontSize: FontSize.xs, color: Colors.textMuted },
  closeBtn: { alignItems: 'center', paddingVertical: Spacing.lg, marginTop: Spacing.sm },
  closeBtnText: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '600' },

  // Adjust modal
  adjOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: Spacing.xl },
  adjSheet:    { backgroundColor: Colors.surface, borderRadius: BorderRadius.xxxl, padding: Spacing.xxl, ...Shadows.lg },
  adjTitle:    { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  adjSub:      { fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing.xl },
  adjLabel:    { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  adjInput: {
    backgroundColor: Colors.background, borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    fontSize: FontSize.lg, color: Colors.text, fontWeight: '700',
    borderWidth: 1.5, borderColor: Colors.border, marginBottom: Spacing.xl,
  },
  adjActions:      { flexDirection: 'row', gap: Spacing.md },
  adjCancel:       { flex: 1, paddingVertical: 13, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  adjCancelText:   { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: '600' },
  adjConfirm:      { flex: 2, paddingVertical: 13, borderRadius: BorderRadius.lg, backgroundColor: Colors.primary, alignItems: 'center', ...Shadows.primary },
  adjConfirmText:  { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  toggleRow:         { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', marginBottom: Spacing.xl },
  togglePill:        { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.round, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background },
  togglePillActive:  { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  togglePillText:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  togglePillTextActive: { color: Colors.primary },
});

export default LoyaltyProgramScreen;
