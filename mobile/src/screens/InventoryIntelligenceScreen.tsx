import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, BorderRadius, Spacing } from '../utils/constants';
import { useSettings } from '../context/SettingsContext';
import {
  getWasteAnalysis, getInventoryIntelCostVariance,
  getInventoryValue, getStockMovement, getPurchaseIntelligence,
} from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type WasteData = Awaited<ReturnType<typeof getWasteAnalysis>>;
type CostData  = Awaited<ReturnType<typeof getInventoryIntelCostVariance>>;
type ValData   = Awaited<ReturnType<typeof getInventoryValue>>;
type MovData   = Awaited<ReturnType<typeof getStockMovement>>;
type PurchData = Awaited<ReturnType<typeof getPurchaseIntelligence>>;

type Tab = 'waste' | 'cost' | 'stock' | 'movement' | 'purchases';

const TABS: { key: Tab; label: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }[] = [
  { key: 'waste',     label: 'Waste',     icon: 'delete-outline'     },
  { key: 'cost',      label: 'Cost',      icon: 'trending-up'        },
  { key: 'stock',     label: 'Stock',     icon: 'inventory-2'        },
  { key: 'movement',  label: 'Movement',  icon: 'swap-vert'          },
  { key: 'purchases', label: 'Purchases', icon: 'shopping-cart'      },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt0(n: number) { return n.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function fmt2(n: number) { return n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }

function defaultFrom() {
  const d = new Date(Date.now() - 29 * 86_400_000);
  return d.toLocaleDateString('en-CA');
}
function defaultTo() { return new Date().toLocaleDateString('en-CA'); }

// ── Sub-components ────────────────────────────────────────────────────────────

function KPIRow({ items }: { items: { label: string; value: string; sub?: string; accent?: boolean }[] }) {
  return (
    <View style={styles.kpiRow}>
      {items.map((it, i) => (
        <View key={i} style={[styles.kpiCard, it.accent && styles.kpiCardAccent]}>
          <Text style={styles.kpiLabel}>{it.label}</Text>
          <Text style={[styles.kpiValue, it.accent && { color: Colors.primary }]}>{it.value}</Text>
          {it.sub ? <Text style={styles.kpiSub}>{it.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <Text style={styles.sectionTitle}>{text}</Text>;
}

function HorizBar({ label, value, max, sym }: { label: string; value: number; max: number; sym: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` as `${number}%` }]} />
      </View>
      <Text style={styles.barValue}>{sym}{fmt0(value)}</Text>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

const InventoryIntelligenceScreen: React.FC = () => {
  const { settings } = useSettings();
  const { bottom } = useSafeAreaInsets();
  const sym = settings?.currencySymbol ?? '₹';
  const cur = (n: number) => `${sym}${fmt0(n)}`;

  const [tab,      setTab]      = useState<Tab>('waste');
  const [from]                  = useState(defaultFrom);
  const [to]                    = useState(defaultTo);
  const [loading,  setLoading]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const [wasteData, setWasteData] = useState<WasteData | null>(null);
  const [costData,  setCostData]  = useState<CostData  | null>(null);
  const [valData,   setValData]   = useState<ValData   | null>(null);
  const [movData,   setMovData]   = useState<MovData   | null>(null);
  const [purchData, setPurchData] = useState<PurchData | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      switch (tab) {
        case 'waste':     setWasteData(await getWasteAnalysis({ from, to }));            break;
        case 'cost':      setCostData(await getInventoryIntelCostVariance());             break;
        case 'stock':     setValData(await getInventoryValue());                          break;
        case 'movement':  setMovData(await getStockMovement({ from, to }));              break;
        case 'purchases': setPurchData(await getPurchaseIntelligence({ from, to }));     break;
      }
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, from, to]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  // ── Waste tab ──────────────────────────────────────────────────────────────

  function renderWaste() {
    if (!wasteData) return null;
    const { summary, byReason, topItems } = wasteData;
    const maxReason = Math.max(...byReason.map(r => r.totalLoss), 1);
    const maxItem   = Math.max(...topItems.map(i => i.totalLoss), 1);
    return (
      <ScrollView>
        <KPIRow items={[
          { label: 'Total Waste Cost',    value: cur(summary.totalCost),    accent: true },
          { label: 'Waste % of Revenue',  value: `${summary.wastePct}%` },
        ]} />
        <KPIRow items={[
          { label: 'Incidents',           value: fmt0(summary.itemCount) },
          { label: 'Avg Daily Loss',      value: cur(summary.avgDailyLoss) },
        ]} />
        <SectionTitle text="Waste by Reason" />
        <View style={styles.card}>
          {byReason.map((r, i) => <HorizBar key={i} label={r.reason} value={r.totalLoss} max={maxReason} sym={sym} />)}
        </View>
        <SectionTitle text="Top Wasted Items" />
        <View style={styles.card}>
          {topItems.map((it, i) => <HorizBar key={i} label={it.productName} value={it.totalLoss} max={maxItem} sym={sym} />)}
        </View>
      </ScrollView>
    );
  }

  // ── Cost Variance tab ──────────────────────────────────────────────────────

  function renderCost() {
    if (!costData) return null;
    const { items, summary } = costData;
    return (
      <ScrollView>
        <KPIRow items={[
          { label: 'Price Increased', value: String(summary.increased), accent: true },
          { label: 'Decreased',       value: String(summary.decreased) },
          { label: 'Stable',          value: String(summary.stable) },
        ]} />
        <SectionTitle text="Cost Variance (vs avg purchase price)" />
        <View style={styles.card}>
          {items.map((it, i) => (
            <View key={i} style={[styles.tableRow, i === items.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tableName}>{it.name} <Text style={styles.tableUnit}>/{it.unit}</Text></Text>
                <Text style={styles.tableSub}>WAC: {sym}{fmt2(it.currentCost)}  Avg: {sym}{fmt2(it.avgPurchaseCost)}</Text>
              </View>
              <View style={styles.tableRight}>
                <Text style={[
                  styles.tableVariance,
                  it.trend === 'increased' ? styles.varUp : it.trend === 'decreased' ? styles.varDown : styles.varStable,
                ]}>
                  {it.variancePct > 0 ? '+' : ''}{fmt2(it.variancePct)}%
                </Text>
                <View style={styles.trendBadge}>
                  <MaterialIcons
                    name={it.trend === 'increased' ? 'arrow-upward' : it.trend === 'decreased' ? 'arrow-downward' : 'remove'}
                    size={11}
                    color={it.trend === 'increased' ? '#C62828' : it.trend === 'decreased' ? '#2E7D32' : Colors.textMuted}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  // ── Stock Value tab ────────────────────────────────────────────────────────

  function renderStockValue() {
    if (!valData) return null;
    const { summary, topByValue, lowStockItems, outOfStockItems } = valData;
    return (
      <ScrollView>
        <KPIRow items={[
          { label: 'Total Stock Value', value: cur(summary.currentStockValue), accent: true },
          { label: 'Low Stock Items',   value: fmt0(summary.lowStockCount) },
        ]} />
        <KPIRow items={[
          { label: 'Out of Stock',      value: fmt0(summary.outOfStockCount) },
          { label: 'Low Stock Value',   value: cur(summary.lowStockValue) },
        ]} />

        {lowStockItems.length > 0 && (
          <>
            <SectionTitle text={`Low Stock (${lowStockItems.length})`} />
            <View style={styles.card}>
              {lowStockItems.map((it, i) => (
                <View key={i} style={[styles.tableRow, i === lowStockItems.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tableName}>{it.name}</Text>
                    <Text style={styles.tableSub}>{it.unit} · Threshold: {fmt2(it.lowStockThreshold)}</Text>
                  </View>
                  <Text style={[styles.tableVariance, styles.varUp]}>{fmt2(it.currentStock)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <SectionTitle text="Top by Value" />
        <View style={styles.card}>
          {topByValue.slice(0, 15).map((it, i) => (
            <View key={i} style={[styles.tableRow, i === Math.min(topByValue.length, 15) - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tableName}>{it.name}</Text>
                <Text style={styles.tableSub}>{fmt2(it.currentStock)} {it.unit} × {sym}{fmt2(it.costPerUnit)}</Text>
              </View>
              <Text style={styles.tableValue}>{sym}{fmt0(it.value)}</Text>
            </View>
          ))}
        </View>

        {outOfStockItems.length > 0 && (
          <>
            <SectionTitle text={`Out of Stock (${outOfStockItems.length})`} />
            <View style={styles.card}>
              {outOfStockItems.map((it, i) => (
                <View key={i} style={[styles.tableRow, i === outOfStockItems.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={styles.tableName}>{it.name}</Text>
                  <Text style={[styles.tableVariance, styles.varUp]}>0 {it.unit}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    );
  }

  // ── Stock Movement tab ─────────────────────────────────────────────────────

  function renderMovement() {
    if (!movData) return null;
    const { summary, fastMoving, slowMoving, deadStock } = movData;
    return (
      <ScrollView>
        <KPIRow items={[
          { label: 'Fast Moving',    value: fmt0(summary.fastMovingCount), accent: true },
          { label: 'Slow Moving',    value: fmt0(summary.slowMovingCount) },
        ]} />
        <KPIRow items={[
          { label: 'Dead Stock',     value: fmt0(summary.deadStockCount) },
          { label: 'Dead Stock Value', value: cur(summary.deadStockValue) },
        ]} />

        {fastMoving.length > 0 && (
          <>
            <SectionTitle text="Fast Moving" />
            <View style={styles.card}>
              {fastMoving.map((it, i) => (
                <View key={i} style={[styles.tableRow, i === fastMoving.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tableName}>{it.name}</Text>
                    <Text style={styles.tableSub}>Consumed: {fmt2(it.totalConsumed)} {it.unit}</Text>
                  </View>
                  <Text style={styles.tableValue}>{fmt2(it.avgDailyConsumption)}/day</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {slowMoving.length > 0 && (
          <>
            <SectionTitle text="Slow Moving" />
            <View style={styles.card}>
              {slowMoving.map((it, i) => (
                <View key={i} style={[styles.tableRow, i === slowMoving.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tableName}>{it.name}</Text>
                    <Text style={styles.tableSub}>Consumed: {fmt2(it.totalConsumed)} {it.unit}</Text>
                  </View>
                  <Text style={styles.tableValue}>{fmt2(it.avgDailyConsumption)}/day</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {deadStock.length > 0 && (
          <>
            <SectionTitle text="Dead Stock (0 consumption this period)" />
            <View style={styles.card}>
              {deadStock.map((it, i) => (
                <View key={i} style={[styles.tableRow, i === deadStock.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tableName}>{it.name}</Text>
                    <Text style={styles.tableSub}>{fmt2(it.currentStock)} {it.unit} in stock</Text>
                  </View>
                  <Text style={[styles.tableVariance, styles.varUp]}>{cur(it.value)}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    );
  }

  // ── Purchases tab ──────────────────────────────────────────────────────────

  function renderPurchases() {
    if (!purchData) return null;
    const { summary, topIngredients, vendorContribution, monthlySpend } = purchData;
    return (
      <ScrollView>
        <KPIRow items={[
          { label: 'Total Spend',    value: cur(summary.totalSpend), accent: true },
          { label: 'GRNs Received', value: fmt0(summary.totalGRNs) },
        ]} />
        <KPIRow items={[
          { label: 'Unique Vendors',     value: fmt0(summary.uniqueVendors) },
          { label: 'Ingredients Bought', value: fmt0(summary.uniqueIngredients) },
        ]} />

        {monthlySpend.length > 0 && (
          <>
            <SectionTitle text="Monthly Spend" />
            <View style={styles.card}>
              {monthlySpend.map((m, i) => (
                <View key={i} style={[styles.tableRow, i === monthlySpend.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={styles.tableName}>{m._id}</Text>
                  <Text style={styles.tableValue}>{cur(m.totalSpend)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <SectionTitle text="Vendor Contribution" />
        <View style={styles.card}>
          {vendorContribution.map((v, i) => (
            <View key={i} style={[styles.vendorRow, i === vendorContribution.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tableName}>{v.vendorName || v.vendorCode}</Text>
                <View style={styles.barTrackSmall}>
                  <View style={[styles.barFillSmall, { width: `${v.pct}%` as `${number}%` }]} />
                </View>
              </View>
              <View style={styles.tableRight}>
                <Text style={styles.tableValue}>{cur(v.totalSpend)}</Text>
                <Text style={styles.tableSub}>{v.pct}%</Text>
              </View>
            </View>
          ))}
        </View>

        <SectionTitle text="Top Ingredients by Spend" />
        <View style={styles.card}>
          {topIngredients.map((it, i) => (
            <View key={i} style={[styles.tableRow, i === topIngredients.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tableName}>{it.name}</Text>
                <Text style={styles.tableSub}>{fmt2(it.totalQty)} {it.unit} · avg {sym}{fmt2(it.avgPrice)}</Text>
              </View>
              <Text style={styles.tableValue}>{cur(it.totalValue)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const content = () => {
    if (loading) return <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />;
    if (error)   return <Text style={styles.errorText}>{error}</Text>;
    switch (tab) {
      case 'waste':     return renderWaste();
      case 'cost':      return renderCost();
      case 'stock':     return renderStockValue();
      case 'movement':  return renderMovement();
      case 'purchases': return renderPurchases();
    }
  };

  return (
    <View style={[styles.container, { paddingBottom: bottom }]}>
      {/* Date label */}
      <View style={styles.dateBar}>
        <Text style={styles.dateText}>{from} – {to} (30 days)</Text>
      </View>

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabContainer}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}>
            <MaterialIcons name={t.icon} size={14} color={tab === t.key ? '#fff' : Colors.textMuted} />
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: Spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {content()}
      </ScrollView>
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.background },
  dateBar:       { paddingHorizontal: Spacing.md, paddingVertical: 6, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  dateText:      { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  tabScroll:     { flexGrow: 0, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabContainer:  { flexDirection: 'row', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  tabBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.round, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  tabBtnActive:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabLabel:      { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '500' },
  tabLabelActive:{ color: '#fff' },
  content:       { flex: 1 },
  kpiRow:        { flexDirection: 'row', gap: 10, marginHorizontal: Spacing.md, marginTop: Spacing.md },
  kpiCard:       { flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  kpiCardAccent: { borderColor: Colors.primary + '50', backgroundColor: Colors.primary + '08' },
  kpiLabel:      { fontSize: 10, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiValue:      { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: 2 },
  kpiSub:        { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  card:          { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, marginHorizontal: Spacing.md, marginTop: 6, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  sectionTitle:  { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginHorizontal: Spacing.md, marginTop: Spacing.md, marginBottom: 4 },
  tableRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  vendorRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tableName:     { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500' },
  tableUnit:     { color: Colors.textMuted, fontWeight: '400' },
  tableSub:      { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  tableRight:    { alignItems: 'flex-end' },
  tableValue:    { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  tableVariance: { fontSize: FontSize.sm, fontWeight: '700' },
  trendBadge:    { marginTop: 2 },
  varUp:         { color: '#C62828' },
  varDown:       { color: '#2E7D32' },
  varStable:     { color: Colors.textMuted },
  barRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  barLabel:      { width: 90, fontSize: FontSize.xs, color: Colors.textMuted },
  barTrack:      { flex: 1, height: 14, backgroundColor: Colors.border, borderRadius: 7, overflow: 'hidden' },
  barFill:       { height: '100%', backgroundColor: Colors.primary, borderRadius: 7, opacity: 0.75 },
  barValue:      { width: 64, fontSize: FontSize.xs, fontWeight: '600', color: Colors.text, textAlign: 'right' },
  barTrackSmall: { height: 4, backgroundColor: Colors.border, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  barFillSmall:  { height: '100%', backgroundColor: Colors.primary, borderRadius: 2, opacity: 0.75 },
  errorText:     { color: Colors.danger, textAlign: 'center', marginTop: 40, paddingHorizontal: Spacing.md },
});

export default InventoryIntelligenceScreen;
