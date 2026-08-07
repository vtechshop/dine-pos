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
import { GiftVoucher } from '../types';

type Tab = 'vouchers' | 'check';

const GiftVoucherScreen: React.FC = () => {
  const { settings } = useSettings();
  const { bottom } = useSafeAreaInsets();
  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const [tab, setTab]         = useState<Tab>('vouchers');
  const [vouchers, setVouchers] = useState<GiftVoucher[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [page, setPage]       = useState(1);

  const [issueForm, setIssueForm] = useState({
    amount: '',
    issuedToName: '',
    issuedToPhone: '',
    expiresAt: '',
  });

  // Check/Redeem
  const [checkCode, setCheckCode]   = useState('');
  const [checkResult, setCheckResult] = useState<{ valid: boolean; voucher?: GiftVoucher; message?: string } | null>(null);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeeming, setRedeeming]   = useState(false);
  const [checking, setChecking]     = useState(false);


  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const data = await api.getGiftVouchers({ page: p });
      if (p === 1) setVouchers(data.vouchers);
      else setVouchers(prev => [...prev, ...data.vouchers]);
      setTotal(data.total);
      setPage(p);
    } catch {
      Alert.alert('Error', 'Failed to load gift vouchers');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(1); }, [load]));

  const issue = async () => {
    const amount = parseFloat(issueForm.amount);
    if (!amount || amount <= 0) { Alert.alert('Validation', 'Amount must be > 0'); return; }

    setSaving(true);
    try {
      const result = await api.issueGiftVoucher({
        amount,
        issuedToName: issueForm.issuedToName.trim() || undefined,
        issuedToPhone: issueForm.issuedToPhone.trim() || undefined,
        expiresAt: issueForm.expiresAt.trim() || undefined,
      });
      setShowIssueModal(false);
      setIssueForm({ amount: '', issuedToName: '', issuedToPhone: '', expiresAt: '' });
      load(1);
      Alert.alert('Voucher Issued', `Code: ${result.voucher.voucherCode}\nAmount: ${fmt(result.voucher.originalAmount)}`);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to issue voucher');
    } finally {
      setSaving(false);
    }
  };

  const checkVoucher = async () => {
    const code = checkCode.trim().toUpperCase();
    if (!code) { Alert.alert('Validation', 'Enter a voucher code'); return; }
    setChecking(true);
    setCheckResult(null);
    setRedeemAmount('');
    try {
      const result = await api.checkGiftVoucher(code);
      setCheckResult(result);
    } catch {
      setCheckResult({ valid: false, message: 'Failed to check voucher' });
    } finally {
      setChecking(false);
    }
  };

  const redeem = async () => {
    if (!checkResult?.voucher) return;
    const amount = parseFloat(redeemAmount);
    if (!amount || amount <= 0) { Alert.alert('Validation', 'Enter redemption amount'); return; }
    if (amount > checkResult.voucher.balance) {
      Alert.alert('Validation', `Cannot redeem more than balance (${fmt(checkResult.voucher.balance)})`);
      return;
    }

    setRedeeming(true);
    try {
      const result = await api.redeemGiftVoucher(checkResult.voucher.voucherCode, amount);
      Alert.alert('Success', `Redeemed ${fmt(result.redeemedAmount)}\nRemaining balance: ${fmt(result.newBalance)}`);
      setCheckCode('');
      setCheckResult(null);
      setRedeemAmount('');
      load(1);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to redeem');
    } finally {
      setRedeeming(false);
    }
  };

  const renderVoucher = ({ item }: { item: GiftVoucher }) => {
    const expired = item.expiresAt ? new Date(item.expiresAt) < new Date() : false;
    const empty   = item.balance === 0;
    const statusColor = !item.isActive
      ? Colors.textMuted
      : expired ? '#F59E0B'
      : empty ? '#F59E0B'
      : Colors.success;
    const statusLabel = !item.isActive
      ? (empty ? 'Used Up' : 'Inactive')
      : expired ? 'Expired'
      : 'Active';

    return (
      <View style={[styles.card, !item.isActive && { opacity: 0.65 }]}>
        <View style={styles.cardHeader}>
          <View style={styles.codeTag}>
            <Text style={styles.codeText}>{item.voucherCode}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        <View style={styles.amountRow}>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Balance</Text>
            <Text style={[styles.balanceValue, { color: item.balance > 0 ? Colors.success : Colors.textMuted }]}>
              {fmt(item.balance)}
            </Text>
          </View>
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Original</Text>
            <Text style={styles.infoValue}>{fmt(item.originalAmount)}</Text>
          </View>
        </View>

        {(item.issuedToName || item.issuedToPhone) && (
          <Text style={styles.issuedTo}>
            <MaterialIcons name="person" size={12} color={Colors.textMuted} />
            {' '}{item.issuedToName}{item.issuedToPhone ? ` · ${item.issuedToPhone}` : ''}
          </Text>
        )}

        <Text style={styles.dateText}>
          Issued: {new Date(item.createdAt).toLocaleDateString('en-IN')}
          {item.expiresAt ? ` · Expires: ${new Date(item.expiresAt).toLocaleDateString('en-IN')}` : ''}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Gift Vouchers</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowIssueModal(true)}>
          <MaterialIcons name="card-giftcard" size={18} color={Colors.white} />
          <Text style={styles.addBtnText}>Issue</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['vouchers', 'check'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
              {t === 'vouchers' ? `All Vouchers (${total})` : 'Check / Redeem'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'vouchers' ? (
        loading && page === 1 ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={vouchers}
            keyExtractor={item => item._id}
            renderItem={renderVoucher}
            contentContainerStyle={{ padding: Spacing.md }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <MaterialIcons name="card-giftcard" size={48} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No vouchers issued yet</Text>
                <Text style={styles.emptyHint}>Tap "Issue" to create a voucher</Text>
              </View>
            }
            onEndReached={() => { if (vouchers.length < total) load(page + 1); }}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loading && page > 1 ? <ActivityIndicator color={Colors.primary} style={{ margin: 16 }} /> : null}
          />
        )
      ) : (
        /* Check / Redeem Panel */
        <ScrollView style={styles.checkPanel} keyboardShouldPersistTaps="handled">
          <Text style={styles.checkTitle}>Check Voucher Balance</Text>

          <View style={styles.searchRow}>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="Enter voucher code (e.g. GV-ABCD1234)"
              placeholderTextColor={Colors.textMuted}
              value={checkCode}
              onChangeText={v => { setCheckCode(v.toUpperCase()); setCheckResult(null); }}
              autoCapitalize="characters"
            />
            <TouchableOpacity style={styles.checkBtn} onPress={checkVoucher} disabled={checking}>
              {checking
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={styles.checkBtnText}>Check</Text>
              }
            </TouchableOpacity>
          </View>

          {checkResult && (
            <View style={[styles.resultCard, { borderColor: checkResult.valid ? Colors.success : Colors.danger }]}>
              {checkResult.valid && checkResult.voucher ? (
                <>
                  <View style={styles.resultHeader}>
                    <MaterialIcons name="check-circle" size={22} color={Colors.success} />
                    <Text style={[styles.resultLabel, { color: Colors.success }]}>Valid Voucher</Text>
                  </View>
                  <Text style={styles.resultCode}>{checkResult.voucher.voucherCode}</Text>
                  <Text style={styles.resultBalance}>Balance: {fmt(checkResult.voucher.balance)}</Text>
                  {checkResult.voucher.expiresAt && (
                    <Text style={styles.resultExpiry}>
                      Expires: {new Date(checkResult.voucher.expiresAt).toLocaleDateString('en-IN')}
                    </Text>
                  )}

                  {checkResult.voucher.balance > 0 && (
                    <View style={styles.redeemRow}>
                      <TextInput
                        style={[styles.input, styles.redeemInput]}
                        placeholder={`Amount to redeem (max ${fmt(checkResult.voucher.balance)})`}
                        placeholderTextColor={Colors.textMuted}
                        value={redeemAmount}
                        onChangeText={setRedeemAmount}
                        keyboardType="decimal-pad"
                      />
                      <TouchableOpacity
                        style={[styles.redeemBtn, redeeming && { opacity: 0.6 }]}
                        onPress={redeem}
                        disabled={redeeming}
                      >
                        {redeeming
                          ? <ActivityIndicator color={Colors.white} size="small" />
                          : <Text style={styles.redeemBtnText}>Redeem</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.resultHeader}>
                  <MaterialIcons name="cancel" size={22} color={Colors.danger} />
                  <Text style={[styles.resultLabel, { color: Colors.danger }]}>
                    {checkResult.message || 'Invalid voucher'}
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* Issue Modal */}
      <Modal visible={showIssueModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowIssueModal(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Issue Gift Voucher</Text>
            <TouchableOpacity onPress={() => setShowIssueModal(false)}>
              <MaterialIcons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Amount ({cur}) *</Text>
            <TextInput
              style={styles.input}
              placeholder="500"
              placeholderTextColor={Colors.textMuted}
              value={issueForm.amount}
              onChangeText={v => setIssueForm(f => ({ ...f, amount: v }))}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>Recipient Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Optional"
              placeholderTextColor={Colors.textMuted}
              value={issueForm.issuedToName}
              onChangeText={v => setIssueForm(f => ({ ...f, issuedToName: v }))}
            />

            <Text style={styles.fieldLabel}>Recipient Phone</Text>
            <TextInput
              style={styles.input}
              placeholder="Optional"
              placeholderTextColor={Colors.textMuted}
              value={issueForm.issuedToPhone}
              onChangeText={v => setIssueForm(f => ({ ...f, issuedToPhone: v }))}
              keyboardType="phone-pad"
            />

            <Text style={styles.fieldLabel}>Expiry Date</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD (blank = no expiry)"
              placeholderTextColor={Colors.textMuted}
              value={issueForm.expiresAt}
              onChangeText={v => setIssueForm(f => ({ ...f, expiresAt: v }))}
            />

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={issue}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.saveBtnText}>Issue Voucher</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  addBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },

  tabRow: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tabBtn: {
    flex: 1, alignItems: 'center', paddingVertical: Spacing.sm,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: Colors.primary },
  tabBtnText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  tabBtnTextActive: { color: Colors.primary },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.md, marginBottom: Spacing.sm, ...Shadows.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  codeTag: {
    backgroundColor: Colors.primary + '15', paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  codeText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary, letterSpacing: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.round },
  statusText: { fontSize: FontSize.xs, fontWeight: '700' },

  amountRow: { flexDirection: 'row', gap: Spacing.lg, marginBottom: 6 },
  infoItem: {},
  infoLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 2 },
  infoValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  balanceValue: { fontSize: FontSize.lg, fontWeight: '800' },

  issuedTo: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 4 },
  dateText: { fontSize: FontSize.xs, color: Colors.textMuted },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: FontSize.lg, color: Colors.textMuted, marginTop: Spacing.md },
  emptyHint: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },

  // Check Panel
  checkPanel: { flex: 1, padding: Spacing.md },
  checkTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: Spacing.md },
  codeInput: { flex: 1 },
  checkBtn: {
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md, justifyContent: 'center',
  },
  checkBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },

  resultCard: {
    borderWidth: 1.5, borderRadius: BorderRadius.lg,
    padding: Spacing.md, backgroundColor: Colors.surface,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  resultLabel: { fontSize: FontSize.md, fontWeight: '700' },
  resultCode: { fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: 4 },
  resultBalance: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  resultExpiry: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: Spacing.sm },

  redeemRow: { flexDirection: 'row', gap: 8, marginTop: Spacing.sm },
  redeemInput: { flex: 1 },
  redeemBtn: {
    backgroundColor: Colors.success, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md, justifyContent: 'center',
  },
  redeemBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },

  // Modal
  modal: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.md, backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  modalBody: { padding: Spacing.md },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: 4, marginTop: Spacing.sm },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.sm, fontSize: FontSize.md, color: Colors.text,
  },
  saveBtn: {
    backgroundColor: Colors.primary, padding: Spacing.md, borderRadius: BorderRadius.md,
    alignItems: 'center', marginTop: Spacing.lg, marginBottom: 40,
  },
  saveBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },
});

export default GiftVoucherScreen;
