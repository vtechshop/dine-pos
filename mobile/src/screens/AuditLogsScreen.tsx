import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../utils/constants';
import * as api from '../services/api';
import { AuditLogEntry } from '../services/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

type DatePeriod = 'today' | 'yesterday' | 'week' | 'custom';
type RoleFilter = 'all' | 'admin' | 'cashier' | 'waiter';

const DATE_PERIODS: DatePeriod[] = ['today', 'yesterday', 'week', 'custom'];
const DATE_PERIOD_LABELS: Record<DatePeriod, string> = {
  today:     'Today',
  yesterday: 'Yesterday',
  week:      'This Week',
  custom:    'Custom',
};
const ROLE_FILTERS: RoleFilter[] = ['all', 'admin', 'cashier', 'waiter'];

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

function periodDates(period: DatePeriod): { from: string; to: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (period === 'today')     return { from: todayStr(), to: todayStr() };
  if (period === 'yesterday') {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    const ys = fmt(y);
    return { from: ys, to: ys };
  }
  if (period === 'week') {
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(today); mon.setDate(today.getDate() + diff);
    return { from: fmt(mon), to: todayStr() };
  }
  return { from: todayStr(), to: todayStr() };
}

function actionColor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('login') || a.includes('logout')) return Colors.info;
  if (a.includes('create') || a.includes('add'))   return Colors.success;
  if (a.includes('update') || a.includes('edit'))  return Colors.warning;
  if (a.includes('delete') || a.includes('remove')) return Colors.danger;
  return Colors.textSecondary;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// ── Main Component ────────────────────────────────────────────────────────────

const AuditLogsScreen: React.FC = () => {
  const { bottom } = useSafeAreaInsets();

  const [logs, setLogs]             = useState<AuditLogEntry[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [pages, setPages]           = useState(1);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [datePeriod, setDatePeriod] = useState<DatePeriod>('today');
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo]     = useState(todayStr());
  const [activeFrom, setActiveFrom] = useState(todayStr());
  const [activeTo, setActiveTo]     = useState(todayStr());
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async (p = 1, refresh = false) => {
    if (p === 1) refresh ? setRefreshing(true) : setLoading(true);
    try {
      const params: Parameters<typeof api.fetchAuditLogs>[0] = {
        from:  activeFrom,
        to:    activeTo,
        page:  p,
        limit: 30,
      };
      if (roleFilter !== 'all') params.actorRole = roleFilter;
      const data = await api.fetchAuditLogs(params);
      if (p === 1) setLogs(data.logs);
      else setLogs(prev => [...prev, ...data.logs]);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      Alert.alert('Error', 'Failed to load audit logs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeFrom, activeTo, roleFilter]);

  useFocusEffect(useCallback(() => { load(1); }, [load]));

  const applyPeriod = (period: DatePeriod) => {
    setDatePeriod(period);
    if (period !== 'custom') {
      const { from, to } = periodDates(period);
      setActiveFrom(from);
      setActiveTo(to);
    }
  };

  // ── Render Detail ─────────────────────────────────────────────────────────

  const showDetails = (item: AuditLogEntry) => {
    if (!item.details) return;
    const entries = Object.entries(item.details);
    const text = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
    Alert.alert('Details', text || '(empty)');
  };

  // ── Render Item ───────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: AuditLogEntry }) => {
    const aColor = actionColor(item.action);
    const detailEntries = item.details ? Object.entries(item.details) : [];
    const showInline = detailEntries.length > 0 && detailEntries.length <= 3;

    return (
      <View style={styles.card}>
        {/* Row 1: action + targetType badge */}
        <View style={styles.cardRow}>
          <Text style={[styles.actionText, { color: aColor }]}>{item.action}</Text>
          {item.targetType && (
            <View style={[styles.badge, { backgroundColor: aColor + '18' }]}>
              <Text style={[styles.badgeTxt, { color: aColor }]}>{item.targetType}</Text>
            </View>
          )}
        </View>

        {/* Actor */}
        {(item.actorName || item.actorRole) && (
          <View style={styles.actorRow}>
            <Text style={styles.actorName}>{item.actorName || 'Unknown'}</Text>
            {item.actorRole && (
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeTxt}>{item.actorRole}</Text>
              </View>
            )}
          </View>
        )}

        {/* IP */}
        {item.ip && (
          <Text style={styles.ipText}>{item.ip}</Text>
        )}

        {/* Details */}
        {showInline && (
          <View style={styles.detailBlock}>
            {detailEntries.map(([k, v]) => (
              <Text key={k} style={styles.detailRow} numberOfLines={1}>
                <Text style={styles.detailKey}>{k}: </Text>
                {String(v)}
              </Text>
            ))}
          </View>
        )}
        {!showInline && detailEntries.length > 3 && (
          <TouchableOpacity onPress={() => showDetails(item)} style={styles.detailLink}>
            <MaterialIcons name="info-outline" size={14} color={Colors.info} />
            <Text style={styles.detailLinkTxt}>View details ({detailEntries.length} fields)</Text>
          </TouchableOpacity>
        )}

        {/* Timestamp */}
        <Text style={styles.timestamp}>{formatTimestamp(item.createdAt)}</Text>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Audit Logs</Text>
        {total > 0 && (
          <Text style={styles.totalCount}>{total} entries</Text>
        )}
      </View>

      {/* Date period chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        {DATE_PERIODS.map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.filterChip, datePeriod === p && styles.filterChipActive]}
            onPress={() => applyPeriod(p)}
          >
            <Text style={[styles.filterChipTxt, datePeriod === p && styles.filterChipTxtActive]}>
              {DATE_PERIOD_LABELS[p]}
            </Text>
          </TouchableOpacity>
        ))}
        {/* separator */}
        <View style={styles.filterSep} />
        {/* Role filters */}
        {ROLE_FILTERS.map(r => (
          <TouchableOpacity
            key={r}
            style={[styles.filterChip, roleFilter === r && styles.filterChipActiveAlt]}
            onPress={() => setRoleFilter(r)}
          >
            <Text style={[styles.filterChipTxt, roleFilter === r && styles.filterChipTxtActive]}>
              {r === 'all' ? 'All Roles' : r.charAt(0).toUpperCase() + r.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Custom date range row */}
      {datePeriod === 'custom' && (
        <View style={styles.customRow}>
          <View style={styles.customInputWrap}>
            <Text style={styles.customLabel}>From</Text>
            <TouchableOpacity
              style={styles.customDateBtn}
              onPress={() => Alert.alert('Tip', 'Enter date as YYYY-MM-DD')}
            >
              <Text style={styles.customDateBtnTxt}>{activeFrom}</Text>
              <MaterialIcons name="edit-calendar" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.customInputWrap}>
            <Text style={styles.customLabel}>To</Text>
            <TouchableOpacity
              style={styles.customDateBtn}
              onPress={() => Alert.alert('Tip', 'Enter date as YYYY-MM-DD')}
            >
              <Text style={styles.customDateBtnTxt}>{activeTo}</Text>
              <MaterialIcons name="edit-calendar" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.applyBtn}
            onPress={() => { setActiveFrom(customFrom); setActiveTo(customTo); }}
          >
            <Text style={styles.applyBtnTxt}>Apply</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={logs}
          renderItem={renderItem}
          keyExtractor={i => i._id}
          contentContainerStyle={[styles.list, { paddingBottom: 40 + bottom }]}
          refreshing={refreshing}
          onRefresh={() => load(1, true)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons name="history" size={56} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No audit log entries</Text>
              <Text style={styles.emptyText}>No activity found for this period</Text>
            </View>
          }
          ListFooterComponent={
            page < pages ? (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={() => load(page + 1)}>
                <Text style={styles.loadMoreTxt}>Load more</Text>
                <MaterialIcons name="expand-more" size={18} color={Colors.primary} />
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  totalCount:  { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },

  filterBar:        { maxHeight: 48, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filterBarContent: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm, alignItems: 'center' as const },
  filterChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.round,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  filterChipActive:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipActiveAlt: { backgroundColor: Colors.infoBg, borderColor: Colors.info },
  filterChipTxt:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  filterChipTxtActive: { color: Colors.white },
  filterSep:           { width: 1, height: 20, backgroundColor: Colors.border, marginHorizontal: 4 },

  customRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  customInputWrap: { flex: 1 },
  customLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 4, fontWeight: '600' },
  customDateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 7, backgroundColor: Colors.card,
  },
  customDateBtnTxt: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  applyBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: 9, backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
  },
  applyBtnTxt: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '700' },

  list: { padding: Spacing.lg },

  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
    marginBottom: Spacing.md, ...Shadows.sm,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  actionText: { fontSize: FontSize.md, fontWeight: '800', flex: 1, marginRight: 8 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTxt:   { fontSize: FontSize.xs, fontWeight: '700' },

  actorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 4 },
  actorName: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  roleBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: Colors.primaryBg, borderWidth: 1, borderColor: Colors.primary + '30',
  },
  roleBadgeTxt: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '700' },

  ipText: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace', marginBottom: 4 },

  detailBlock: {
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    padding: Spacing.md, marginTop: 6, borderWidth: 1, borderColor: Colors.borderLight,
  },
  detailRow: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 2 },
  detailKey: { fontWeight: '700', color: Colors.text },

  detailLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  detailLinkTxt: { fontSize: FontSize.xs, color: Colors.info, fontWeight: '600' },

  timestamp: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 8, textAlign: 'right' },

  empty:      { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginTop: Spacing.lg },
  emptyText:  { color: Colors.textSecondary, marginTop: Spacing.sm },

  loadMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: Spacing.lg, marginTop: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
  },
  loadMoreTxt: { fontSize: FontSize.md, color: Colors.primary, fontWeight: '700' },
});

export default AuditLogsScreen;
