import React, { useState, useEffect, useCallback } from 'react';
import { showAlert } from '../utils/alert';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, TextInput, Modal,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DailyReport, Product } from '../types';
import { Colors, Spacing, FontSize, BorderRadius } from '../utils/constants';
import { getDailyReport, getProductSalesReport, getLowStockProducts, getWasteAnalytics, createWasteLog } from '../services/api';
import { useSettings } from '../context/SettingsContext';

type Tab = 'daily' | 'products' | 'stock' | 'waste';

interface ProductSale {
  productName: string;
  totalQty: number;
  totalRevenue: number;
}

const WASTE_REASONS = [
  { id: 'expired',     label: 'Expired',     color: '#C62828' },
  { id: 'damaged',     label: 'Damaged',     color: '#E65100' },
  { id: 'overcooked',  label: 'Overcooked',  color: '#F57F17' },
  { id: 'returned',    label: 'Returned',    color: '#1565C0' },
  { id: 'other',       label: 'Other',       color: '#616161' },
] as const;

type WasteReason = typeof WASTE_REASONS[number]['id'];

const getTodayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ReportsScreen: React.FC = () => {
  const { settings } = useSettings();
  const [tab, setTab] = useState<Tab>('daily');
  const [date, setDate] = useState(getTodayString());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [productSales, setProductSales] = useState<ProductSale[]>([]);
  const [lowStock, setLowStock] = useState<Product[]>([]);
  const [wasteData, setWasteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [wasteSaving, setWasteSaving] = useState(false);
  const emptyWasteForm = { productName: '', quantity: '', unit: 'portion', reason: 'expired' as WasteReason, estimatedLoss: '', notes: '' };
  const [wasteForm, setWasteForm] = useState(emptyWasteForm);
  const cur = settings.currencySymbol || '₹';

  const fetchDaily = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const [daily, products] = await Promise.all([
        getDailyReport(d),
        getProductSalesReport(d),
      ]);
      setReport(daily);
      setProductSales(products.products);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLowStock = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLowStockProducts(5);
      setLowStock(res.products);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to load stock');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWaste = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const data = await getWasteAnalytics(d);
      setWasteData(data);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to load waste data');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === 'daily' || tab === 'products') fetchDaily(date);
    else if (tab === 'stock') fetchLowStock();
    else fetchWaste(date);
  }, [tab, date, fetchDaily, fetchLowStock, fetchWaste]);

  const navigateDate = (dir: -1 | 1) => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return;
    d.setDate(d.getDate() + dir);
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };

  const saveWasteLog = async () => {
    if (!wasteForm.productName.trim() || !wasteForm.quantity) {
      showAlert('Error', 'Product name and quantity are required'); return;
    }
    setWasteSaving(true);
    try {
      await createWasteLog({
        productName:   wasteForm.productName.trim(),
        quantity:      parseFloat(wasteForm.quantity) || 1,
        unit:          wasteForm.unit.trim() || 'portion',
        reason:        wasteForm.reason,
        estimatedLoss: parseFloat(wasteForm.estimatedLoss) || 0,
        notes:         wasteForm.notes.trim(),
        date:          date,
      });
      setShowWasteModal(false);
      setWasteForm(emptyWasteForm);
      fetchWaste(date);
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to save waste log');
    } finally { setWasteSaving(false); }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Reports</Text>
        {tab === 'waste' && (
          <TouchableOpacity
            style={styles.headerAddBtn}
            onPress={() => { setWasteForm({ ...emptyWasteForm }); setShowWasteModal(true); }}
            activeOpacity={0.8}
          >
            <MaterialIcons name="add" size={22} color={Colors.white} />
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {([
          { key: 'daily',    label: 'Daily',     icon: 'bar-chart' },
          { key: 'products', label: 'Products',  icon: 'restaurant-menu' },
          { key: 'stock',    label: 'Low Stock', icon: 'warning' },
          { key: 'waste',    label: 'Waste',     icon: 'delete-sweep' },
        ] as { key: Tab; label: string; icon: any }[]).map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={t.icon}
              size={15}
              color={tab === t.key ? Colors.primary : Colors.textSecondary}
            />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
            {t.key === 'stock' && lowStock.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{lowStock.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Date selector (not shown on stock tab) */}
      {tab !== 'stock' && (
        <View style={styles.dateRow}>
          <TouchableOpacity style={styles.dateArrow} onPress={() => navigateDate(-1)} activeOpacity={0.7}>
            <Text style={styles.dateArrowText}>{'<'}</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.dateInput}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textMuted}
            onSubmitEditing={() => fetchDaily(date)}
          />
          <TouchableOpacity style={styles.dateArrow} onPress={() => navigateDate(1)} activeOpacity={0.7}>
            <Text style={styles.dateArrowText}>{'>'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.todayBtn} onPress={() => setDate(getTodayString())} activeOpacity={0.7}>
            <Text style={styles.todayBtnText}>Today</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* ── DAILY TAB ── */}
          {tab === 'daily' && (
            <>
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { borderLeftColor: Colors.primary }]}>
                  <Text style={styles.statLabel}>Total Sales</Text>
                  <Text style={styles.statValueBig}>{cur}{report?.totalSales.toFixed(2) ?? '0.00'}</Text>
                </View>
              </View>

              <View style={styles.statsRowDouble}>
                <View style={[styles.statCardHalf, { borderLeftColor: Colors.cardPayment }]}>
                  <Text style={styles.statLabel}>Total Orders</Text>
                  <Text style={styles.statValueMed}>{report?.totalOrders ?? 0}</Text>
                </View>
                <View style={[styles.statCardHalf, { borderLeftColor: Colors.warning }]}>
                  <Text style={styles.statLabel}>Total Tax</Text>
                  <Text style={styles.statValueMed}>{cur}{report?.totalTax.toFixed(2) ?? '0.00'}</Text>
                </View>
              </View>

              {(report?.totalOrders ?? 0) > 0 && (
                <View style={styles.statsRow}>
                  <View style={[styles.statCard, { borderLeftColor: Colors.success }]}>
                    <Text style={styles.statLabel}>Avg Order Value</Text>
                    <Text style={styles.statValueMed}>
                      {cur}{((report!.totalSales) / report!.totalOrders).toFixed(2)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Payment breakdown */}
              {report && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Payment Breakdown</Text>
                  {[
                    { label: 'Cash', value: report.paymentBreakdown.cash, color: Colors.success },
                    { label: 'UPI', value: report.paymentBreakdown.upi, color: Colors.upi },
                    { label: 'Card', value: report.paymentBreakdown.card, color: Colors.cardPayment },
                    { label: 'Split', value: report.paymentBreakdown.split, color: Colors.warning },
                  ].filter(p => p.value > 0).map(p => (
                    <View key={p.label} style={styles.payRow}>
                      <View style={[styles.payDot, { backgroundColor: p.color }]} />
                      <Text style={styles.payLabel}>{p.label}</Text>
                      <Text style={[styles.payValue, { color: p.color }]}>{cur}{p.value.toFixed(2)}</Text>
                    </View>
                  ))}
                  {Object.values(report.paymentBreakdown).every(v => v === 0) && (
                    <Text style={styles.emptyText}>No orders on this date</Text>
                  )}
                </View>
              )}

              {/* Order source breakdown */}
              {report?.sourceBreakdown && Object.values(report.sourceBreakdown).some(s => s.revenue > 0) && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Order Source Breakdown</Text>
                  {([
                    { key: 'dine-in' as const,  label: '🍴 Dine-in',  color: Colors.primary },
                    { key: 'takeaway' as const,  label: '🥡 Takeaway', color: Colors.warning },
                    { key: 'swiggy' as const,    label: '🛵 Swiggy',   color: '#FC8019' },
                    { key: 'zomato' as const,    label: '🍕 Zomato',   color: '#E23744' },
                    { key: 'qr' as const,        label: '📲 QR Order', color: Colors.upi },
                  ] as { key: keyof NonNullable<typeof report.sourceBreakdown>; label: string; color: string }[])
                    .filter(s => report.sourceBreakdown![s.key]?.revenue > 0)
                    .map(s => {
                      const sd = report.sourceBreakdown![s.key];
                      return (
                        <View key={s.key} style={styles.payRow}>
                          <View style={[styles.payDot, { backgroundColor: s.color }]} />
                          <Text style={styles.payLabel}>{s.label}</Text>
                          <Text style={[styles.payLabel, { color: Colors.textMuted, marginLeft: 4 }]}>{sd.orders} orders</Text>
                          <Text style={[styles.payValue, { color: s.color }]}>{cur}{sd.revenue.toFixed(2)}</Text>
                        </View>
                      );
                    })}
                </View>
              )}
            </>
          )}

          {/* ── PRODUCTS TAB ── */}
          {tab === 'products' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top Selling Items</Text>
              {productSales.length === 0 ? (
                <View style={styles.emptyBox}>
                  <MaterialIcons name="restaurant-menu" size={40} color={Colors.textMuted} />
                  <Text style={styles.emptyText}>No orders on this date</Text>
                </View>
              ) : (
                productSales.map((p, i) => (
                  <View key={p.productName} style={styles.productRow}>
                    <View style={[styles.rank, { backgroundColor: i < 3 ? Colors.primary : Colors.card }]}>
                      <Text style={[styles.rankText, { color: i < 3 ? Colors.white : Colors.textSecondary }]}>
                        #{i + 1}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: Spacing.md }}>
                      <Text style={styles.productName}>{p.productName}</Text>
                      <Text style={styles.productSub}>{p.totalQty} sold</Text>
                    </View>
                    <Text style={styles.productRevenue}>{cur}{p.totalRevenue.toFixed(0)}</Text>
                  </View>
                ))
              )}
            </View>
          )}

          {/* ── WASTE TAB ── */}
          {tab === 'waste' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Food Waste Analytics</Text>
              {!wasteData || wasteData.totalEntries === 0 ? (
                <View style={styles.emptyBox}>
                  <MaterialIcons name="delete-sweep" size={40} color={Colors.textMuted} />
                  <Text style={styles.emptyText}>No waste logged today</Text>
                </View>
              ) : (
                <>
                  <View style={styles.statsRowDouble}>
                    <View style={[styles.statCardHalf, { borderLeftColor: Colors.danger }]}>
                      <Text style={styles.statLabel}>Total Loss</Text>
                      <Text style={[styles.statValueMed, { color: Colors.danger }]}>{cur}{wasteData.totalLoss.toFixed(2)}</Text>
                    </View>
                    <View style={[styles.statCardHalf, { borderLeftColor: Colors.warning }]}>
                      <Text style={styles.statLabel}>Entries</Text>
                      <Text style={styles.statValueMed}>{wasteData.totalEntries}</Text>
                    </View>
                  </View>
                  {wasteData.topItems.length > 0 && (
                    <>
                      <Text style={[styles.sectionTitle, { marginTop: Spacing.lg }]}>Top Wasted Items</Text>
                      {wasteData.topItems.map((item: any, i: number) => (
                        <View key={i} style={styles.stockRow}>
                          <Text style={[styles.productName, { flex: 1 }]}>{item.productName}</Text>
                          <Text style={styles.productSub}>Qty: {item.totalQty}</Text>
                          <View style={[styles.stockBadge, { backgroundColor: Colors.danger + '22', marginLeft: 8 }]}>
                            <Text style={[styles.stockCount, { color: Colors.danger }]}>{cur}{item.totalLoss.toFixed(0)}</Text>
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                  {wasteData.byReason.length > 0 && (
                    <>
                      <Text style={[styles.sectionTitle, { marginTop: Spacing.lg }]}>By Reason</Text>
                      {wasteData.byReason.map((r: any, i: number) => (
                        <View key={i} style={styles.stockRow}>
                          <Text style={[styles.productName, { flex: 1, textTransform: 'capitalize' }]}>{r._id}</Text>
                          <Text style={styles.productSub}>{r.count}x</Text>
                          <View style={[styles.stockBadge, { backgroundColor: Colors.warningBg, marginLeft: 8 }]}>
                            <Text style={[styles.stockCount, { color: Colors.warning }]}>{cur}{r.totalLoss.toFixed(0)}</Text>
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </>
              )}
            </View>
          )}

          {/* ── LOW STOCK TAB ── */}
          {tab === 'stock' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Low Stock Alert (≤ 5 units)</Text>
              {lowStock.length === 0 ? (
                <View style={styles.emptyBox}>
                  <MaterialIcons name="check-circle" size={40} color={Colors.success} />
                  <Text style={[styles.emptyText, { color: Colors.success }]}>All items well stocked!</Text>
                </View>
              ) : (
                lowStock.map(p => (
                  <View key={p._id} style={styles.stockRow}>
                    <View style={styles.stockLeft}>
                      <View style={[styles.vegDot, { backgroundColor: p.isVeg ? Colors.veg : Colors.nonVeg }]} />
                      <View style={{ marginLeft: Spacing.sm }}>
                        <Text style={styles.productName}>{p.name}</Text>
                        <Text style={styles.productSub}>{(p as any).category?.name ?? 'Uncategorised'}</Text>
                      </View>
                    </View>
                    <View style={[styles.stockBadge, { backgroundColor: p.stock! <= 2 ? Colors.danger + '33' : Colors.warning + '33' }]}>
                      <Text style={[styles.stockCount, { color: p.stock! <= 2 ? Colors.danger : Colors.warning }]}>
                        {p.stock} left
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}

        </ScrollView>
      )}
      {/* ── Log Waste Modal ── */}
      <Modal visible={showWasteModal} transparent animationType="slide" onRequestClose={() => setShowWasteModal(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.modal}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Log Food Waste</Text>

              <Text style={styles.modalLabel}>Item Name *</Text>
              <TextInput
                style={styles.modalInput}
                value={wasteForm.productName}
                onChangeText={v => setWasteForm(p => ({ ...p, productName: v }))}
                placeholder="e.g. Chicken Tikka"
                placeholderTextColor={Colors.textMuted}
              />

              <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalLabel}>Quantity *</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={wasteForm.quantity}
                    onChangeText={v => setWasteForm(p => ({ ...p, quantity: v }))}
                    placeholder="1"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalLabel}>Unit</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={wasteForm.unit}
                    onChangeText={v => setWasteForm(p => ({ ...p, unit: v }))}
                    placeholder="portion / kg / pcs"
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>
              </View>

              <Text style={styles.modalLabel}>Reason</Text>
              <View style={styles.reasonRow}>
                {WASTE_REASONS.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.reasonChip, wasteForm.reason === r.id && { backgroundColor: r.color, borderColor: r.color }]}
                    onPress={() => setWasteForm(p => ({ ...p, reason: r.id }))}
                  >
                    <Text style={[styles.reasonChipTxt, wasteForm.reason === r.id && { color: Colors.white }]}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.modalLabel}>Estimated Loss ({cur})</Text>
              <TextInput
                style={styles.modalInput}
                value={wasteForm.estimatedLoss}
                onChangeText={v => setWasteForm(p => ({ ...p, estimatedLoss: v }))}
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />

              <Text style={styles.modalLabel}>Notes (optional)</Text>
              <TextInput
                style={styles.modalInput}
                value={wasteForm.notes}
                onChangeText={v => setWasteForm(p => ({ ...p, notes: v }))}
                placeholder="Additional details..."
                placeholderTextColor={Colors.textMuted}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowWasteModal(false)}>
                  <Text style={styles.modalCancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveBtn} onPress={saveWasteLog} disabled={wasteSaving}>
                  {wasteSaving
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.modalSaveTxt}>Save Log</Text>
                  }
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
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: 'bold', color: Colors.text },
  headerAddBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },

  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    gap: 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Colors.primary },
  tabText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: Colors.primary },
  badge: {
    backgroundColor: Colors.danger,
    borderRadius: BorderRadius.round,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: Colors.white, fontSize: 9, fontWeight: 'bold' },

  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  dateArrow: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.sm,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dateArrowText: { color: Colors.text, fontSize: FontSize.lg, fontWeight: 'bold' },
  dateInput: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    color: Colors.text,
    fontSize: FontSize.sm,
    textAlign: 'center',
    marginHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  todayBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  todayBtnText: { color: Colors.white, fontWeight: '600', fontSize: FontSize.sm },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: Colors.textSecondary, marginTop: Spacing.md },
  scrollContent: { padding: Spacing.lg, paddingBottom: 80 },

  statsRow: { marginBottom: Spacing.md },
  statsRowDouble: { flexDirection: 'row', marginBottom: Spacing.md, gap: Spacing.md },
  statCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statCardHalf: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
  },
  statValueBig: { fontSize: 34, fontWeight: 'bold', color: Colors.text },
  statValueMed: { fontSize: FontSize.xxl, fontWeight: 'bold', color: Colors.text },

  section: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.md,
  },

  payRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm },
  payDot: { width: 10, height: 10, borderRadius: 5, marginRight: Spacing.sm },
  payLabel: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.md },
  payValue: { fontSize: FontSize.md, fontWeight: '700' },

  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rank: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.card,
  },
  rankText: { fontSize: FontSize.sm, fontWeight: 'bold' },
  productName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  productSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  productRevenue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },

  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stockLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  vegDot: { width: 8, height: 8, borderRadius: 4 },
  stockBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
  stockCount: { fontSize: FontSize.sm, fontWeight: '700' },

  emptyBox: { alignItems: 'center', paddingVertical: Spacing.xl },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.md, marginTop: Spacing.sm },

  // Waste log modal
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay },
  modal: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxxl, borderTopRightRadius: BorderRadius.xxxl,
    padding: Spacing.xxl, paddingBottom: 40, marginTop: 80,
  },
  modalHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.lg },
  modalTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center', marginBottom: Spacing.lg },
  modalLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6, marginTop: Spacing.md },
  modalInput: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.text,
  },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  reasonChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: BorderRadius.round, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  reasonChipTxt: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  modalActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  modalCancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: BorderRadius.lg,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
  },
  modalCancelTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.lg },
  modalSaveBtn: {
    flex: 2, paddingVertical: 14, borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary, alignItems: 'center',
  },
  modalSaveTxt: { color: Colors.white, fontWeight: '800', fontSize: FontSize.lg },
});

export default ReportsScreen;
