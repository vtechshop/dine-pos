import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';
import * as api from '../services/api';
import { Expense, PnLReport } from '../types';

type Tab = 'expenses' | 'pnl';

const CATEGORIES: { id: Expense['category']; label: string; icon: string; color: string }[] = [
  { id: 'ingredients', label: 'Ingredients', icon: 'kitchen',       color: '#E65100' },
  { id: 'utilities',   label: 'Utilities',   icon: 'bolt',           color: '#1565C0' },
  { id: 'staff',       label: 'Staff',       icon: 'people',         color: '#6A1B9A' },
  { id: 'maintenance', label: 'Maintenance', icon: 'build',          color: '#2E7D32' },
  { id: 'rent',        label: 'Rent',        icon: 'home',           color: '#C62828' },
  { id: 'other',       label: 'Other',       icon: 'more-horiz',     color: '#616161' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

const ExpenseScreen: React.FC = () => {
  const { settings } = useSettings();
  const cur = settings.currencySymbol || '₹';
  const fmt = (n: number) => `${cur}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const [tab, setTab]           = useState<Tab>('expenses');
  const [date, setDate]         = useState(todayStr());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [pnl, setPnl]           = useState<PnLReport | null>(null);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving]     = useState(false);

  const emptyForm = { description: '', amount: '', category: 'ingredients' as Expense['category'], date: todayStr(), notes: '' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [exp, pnlData] = await Promise.all([
        api.getExpenses({ date }),
        api.getPnLReport(date),
      ]);
      setExpenses(exp);
      setPnl(pnlData);
    } catch { Alert.alert('Error', 'Failed to load data'); }
    finally { setLoading(false); }
  }, [date]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (!form.description.trim() || !form.amount) {
      Alert.alert('Error', 'Description and amount are required'); return;
    }
    setSaving(true);
    try {
      await api.createExpense({
        description: form.description.trim(),
        amount:      parseFloat(form.amount),
        category:    form.category,
        date:        form.date,
        notes:       form.notes.trim(),
      });
      setShowModal(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const del = (e: Expense) => {
    Alert.alert('Delete?', e.description, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await api.deleteExpense(e._id); load(); }
          catch { Alert.alert('Error', 'Failed'); }
        },
      },
    ]);
  };

  const prevDay = () => {
    const d = new Date(date); d.setDate(d.getDate() - 1);
    setDate(d.toISOString().slice(0, 10));
  };
  const nextDay = () => {
    const d = new Date(date); d.setDate(d.getDate() + 1);
    setDate(d.toISOString().slice(0, 10));
  };

  const getCat = (id: string) => CATEGORIES.find(c => c.id === id) || CATEGORIES[5];

  const renderExpense = ({ item }: { item: Expense }) => {
    const cat = getCat(item.category);
    return (
      <View style={styles.card}>
        <View style={[styles.catIcon, { backgroundColor: cat.color + '20' }]}>
          <MaterialIcons name={cat.icon as any} size={22} color={cat.color} />
        </View>
        <View style={{ flex: 1, marginLeft: Spacing.md }}>
          <Text style={styles.expDesc}>{item.description}</Text>
          <Text style={styles.expCat}>{cat.label}</Text>
          {item.notes ? <Text style={styles.expNotes} numberOfLines={1}>{item.notes}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.expAmount}>{fmt(item.amount)}</Text>
          <TouchableOpacity onPress={() => del(item)} style={{ padding: 4 }}>
            <MaterialIcons name="delete-outline" size={18} color={Colors.danger} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Expenses & P&L</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => { setForm({ ...emptyForm, date }); setShowModal(true); }}>
          <MaterialIcons name="add" size={22} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {/* Date navigation */}
      <View style={styles.datePicker}>
        <TouchableOpacity style={styles.dateArrow} onPress={prevDay}>
          <MaterialIcons name="chevron-left" size={26} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.dateText}>{new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
        <TouchableOpacity style={styles.dateArrow} onPress={nextDay}>
          <MaterialIcons name="chevron-right" size={26} color={Colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.todayBtn} onPress={() => setDate(todayStr())}>
          <Text style={styles.todayTxt}>Today</Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.tabs}>
        {(['expenses', 'pnl'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>
              {t === 'pnl' ? 'Profit & Loss' : 'Expenses'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : tab === 'expenses' ? (
        <FlatList
          data={expenses}
          renderItem={renderExpense}
          keyExtractor={e => e._id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            expenses.length > 0 ? (
              <View style={styles.totalBar}>
                <Text style={styles.totalLabel}>Total Expenses</Text>
                <Text style={styles.totalVal}>{fmt(totalExpenses)}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="receipt-long" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No Expenses</Text>
              <Text style={styles.emptyText}>Tap + to log an expense</Text>
            </View>
          }
        />
      ) : (
        <ScrollView contentContainerStyle={styles.pnlList}>
          {pnl && (
            <>
              {/* P&L Summary Cards */}
              <View style={styles.pnlGrid}>
                <View style={[styles.pnlCard, { borderColor: Colors.success }]}>
                  <MaterialIcons name="trending-up" size={24} color={Colors.success} />
                  <Text style={styles.pnlValue}>{fmt(pnl.revenue)}</Text>
                  <Text style={styles.pnlLabel}>Revenue</Text>
                  <Text style={styles.pnlSub}>{pnl.orders} orders</Text>
                </View>
                <View style={[styles.pnlCard, { borderColor: Colors.danger }]}>
                  <MaterialIcons name="trending-down" size={24} color={Colors.danger} />
                  <Text style={[styles.pnlValue, { color: Colors.danger }]}>{fmt(pnl.expenses)}</Text>
                  <Text style={styles.pnlLabel}>Expenses</Text>
                </View>
              </View>

              {/* Net Profit */}
              <View style={[
                styles.profitCard,
                { backgroundColor: pnl.profit >= 0 ? Colors.successBg : Colors.dangerBg,
                  borderColor: pnl.profit >= 0 ? Colors.success : Colors.danger },
              ]}>
                <Text style={styles.profitLabel}>Net Profit</Text>
                <Text style={[styles.profitValue, { color: pnl.profit >= 0 ? Colors.success : Colors.danger }]}>
                  {pnl.profit >= 0 ? '+' : ''}{fmt(pnl.profit)}
                </Text>
                <Text style={[styles.profitMargin, { color: pnl.profit >= 0 ? Colors.success : Colors.danger }]}>
                  {pnl.profitMargin}% margin
                </Text>
              </View>

              {/* Expense breakdown by category */}
              {pnl.breakdown.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Expense Breakdown</Text>
                  {pnl.breakdown.map((b: any) => {
                    const cat = getCat(b._id);
                    return (
                      <View key={b._id} style={styles.breakdownRow}>
                        <View style={[styles.catDot, { backgroundColor: cat.color }]} />
                        <Text style={styles.breakdownCat}>{cat.label}</Text>
                        <Text style={styles.breakdownAmt}>{fmt(b.total)}</Text>
                      </View>
                    );
                  })}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Add Expense Modal */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.overlay}>
          <ScrollView>
            <View style={styles.modal}>
              <View style={styles.handle} />
              <Text style={styles.modalTitle}>Log Expense</Text>

              <Text style={styles.label}>Description *</Text>
              <TextInput
                style={styles.input}
                value={form.description}
                onChangeText={v => setForm(p => ({ ...p, description: v }))}
                placeholder="Chicken, Vegetables, Gas bill..."
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={styles.label}>Amount *</Text>
              <TextInput
                style={styles.input}
                value={form.amount}
                onChangeText={v => setForm(p => ({ ...p, amount: v }))}
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />

              <Text style={styles.label}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
                <View style={styles.catRow}>
                  {CATEGORIES.map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.catChip, form.category === c.id && { backgroundColor: c.color, borderColor: c.color }]}
                      onPress={() => setForm(p => ({ ...p, category: c.id }))}
                    >
                      <MaterialIcons name={c.icon as any} size={14} color={form.category === c.id ? Colors.white : c.color} />
                      <Text style={[styles.catChipTxt, form.category === c.id && { color: Colors.white }]}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.label}>Date</Text>
              <View style={styles.miniDateRow}>
                <TouchableOpacity
                  style={styles.miniArrow}
                  onPress={() => {
                    const d = new Date(form.date); d.setDate(d.getDate() - 1);
                    setForm(p => ({ ...p, date: d.toISOString().slice(0, 10) }));
                  }}
                >
                  <MaterialIcons name="chevron-left" size={22} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.miniDateText}>
                  {new Date(form.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </Text>
                <TouchableOpacity
                  style={styles.miniArrow}
                  onPress={() => {
                    const d = new Date(form.date); d.setDate(d.getDate() + 1);
                    setForm(p => ({ ...p, date: d.toISOString().slice(0, 10) }));
                  }}
                >
                  <MaterialIcons name="chevron-right" size={22} color={Colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.miniTodayBtn}
                  onPress={() => setForm(p => ({ ...p, date: todayStr() }))}
                >
                  <Text style={styles.miniTodayTxt}>Today</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                style={styles.input}
                value={form.notes}
                onChangeText={v => setForm(p => ({ ...p, notes: v }))}
                placeholder="Additional details..."
                placeholderTextColor={Colors.textMuted}
              />

              <View style={styles.mActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.saveTxt}>Save Expense</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.background },
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  addBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', ...Shadows.primary,
  },

  datePicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.md, backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border, gap: Spacing.sm,
  },
  dateArrow:  { padding: Spacing.sm },
  dateText:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, minWidth: 140, textAlign: 'center' },
  todayBtn:   { paddingHorizontal: Spacing.md, paddingVertical: 6, backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.primary + '40' },
  todayTxt:   { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700' },

  tabs: { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: Spacing.md, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabTxt:  { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.md },
  tabTxtActive: { color: Colors.primary, fontWeight: '800' },

  list:       { padding: Spacing.lg, paddingBottom: 100 },
  totalBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.dangerBg, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.danger + '30',
  },
  totalLabel: { fontSize: FontSize.md, color: Colors.danger, fontWeight: '600' },
  totalVal:   { fontSize: FontSize.xl, color: Colors.danger, fontWeight: '800' },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadows.sm,
  },
  catIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  expDesc:  { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  expCat:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  expNotes: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  expAmount:{ fontSize: FontSize.lg, fontWeight: '800', color: Colors.danger },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm },

  pnlList:   { padding: Spacing.lg, paddingBottom: 100 },
  pnlGrid:   { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.lg },
  pnlCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.lg, alignItems: 'center', borderWidth: 2, ...Shadows.sm,
  },
  pnlValue:  { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginTop: Spacing.sm },
  pnlLabel:  { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginTop: 4 },
  pnlSub:    { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },

  profitCard: {
    borderRadius: BorderRadius.xl, padding: Spacing.xl, alignItems: 'center',
    marginBottom: Spacing.xl, borderWidth: 2,
  },
  profitLabel:  { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  profitValue:  { fontSize: FontSize.xxxl, fontWeight: '900', marginTop: Spacing.sm },
  profitMargin: { fontSize: FontSize.md, fontWeight: '600', marginTop: 4 },

  sectionTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  catDot:       { width: 10, height: 10, borderRadius: 5, marginRight: Spacing.md },
  breakdownCat: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  breakdownAmt: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  overlay: { flex: 1, backgroundColor: Colors.overlay },
  modal: {
    backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xxxl,
    borderTopRightRadius: BorderRadius.xxxl, padding: Spacing.xxl, paddingBottom: 40, marginTop: 60,
  },
  handle:     { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  modalTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },
  miniDateRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border, paddingVertical: 4, paddingHorizontal: Spacing.sm,
  },
  miniArrow: { padding: 4 },
  miniDateText: { flex: 1, fontSize: FontSize.md, color: Colors.text, fontWeight: '600', textAlign: 'center' },
  miniTodayBtn: {
    backgroundColor: Colors.primaryBg, borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  miniTodayTxt: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: '700' },

  catRow:     { flexDirection: 'row', gap: Spacing.sm, paddingRight: Spacing.md },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.round,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  catChipTxt: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  mActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  cancelTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.lg },
  saveBtn:   { flex: 2, paddingVertical: 14, borderRadius: BorderRadius.lg, backgroundColor: Colors.primary, alignItems: 'center', ...Shadows.primary },
  saveTxt:   { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },
});

export default ExpenseScreen;
