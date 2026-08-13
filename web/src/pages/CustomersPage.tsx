import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Search, RefreshCw, Users, Star, Award, TrendingUp, Download,
  Layers, AlertTriangle, CheckCircle,
} from 'lucide-react';
import type { CustomerSummary, LoyaltyConfig, CustomerSegment, LoyaltyStats, LoyaltyActivityEntry } from '../types/customers';
import {
  searchCustomers, fetchLoyaltyConfig, fetchLoyaltyStats,
  fetchLoyaltyActivity, searchCustomersBySegment,
} from '../api/loyalty';
import { fetchOrderCustomers } from '../api/orders';
import type { OrderCustomer } from '../api/orders';
import { ApiError } from '../api/client';
import { CustomerRow } from '../components/customers/CustomerRow';
import { CustomerDetail } from '../components/customers/CustomerDetail';
import { OrderOnlyCustomerPanel } from '../components/customers/OrderOnlyCustomerPanel';
import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useShortcut } from '../hooks/useShortcut';

type Tab          = 'customers' | 'segments' | 'loyalty';
type StatusFilter = 'all' | 'active' | 'blocked';
type SortMode     = 'default' | 'spend' | 'visits';

const SEGMENTS: { key: CustomerSegment; label: string; desc: string; icon?: string }[] = [
  { key: 'all',        label: 'All Customers',            desc: 'Everyone in your CRM' },
  { key: 'new',        label: 'New Customers',            desc: 'Visited exactly once' },
  { key: 'repeat',     label: 'Repeat Customers',         desc: 'Visited 2+ times' },
  { key: 'vip',        label: 'VIP / Top Spenders',       desc: 'Sorted by lifetime spend' },
  { key: 'inactive30', label: 'Inactive 30+ Days',        desc: 'No visit in 30 days', icon: '⚠️' },
  { key: 'inactive60', label: 'Inactive 60+ Days',        desc: 'No visit in 60 days', icon: '⚠️' },
  { key: 'inactive90', label: 'Inactive 90+ Days',        desc: 'No visit in 90 days', icon: '🔴' },
  { key: 'birthday',   label: 'Birthday This Month',      desc: 'Celebrate with them' },
  { key: 'anniversary',label: 'Anniversary This Month',   desc: 'Milestone moments' },
  { key: 'loyalty',    label: 'Loyalty Members',          desc: 'Have earned points' },
  { key: 'noloyalty',  label: 'Without Loyalty',          desc: 'Visited but not enrolled' },
];

function looksLikePhone(q: string): boolean {
  return /^[+\d\s\-()]{6,}$/.test(q.trim());
}

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

function toOrderOnlySummary(oc: OrderCustomer): CustomerSummary {
  return {
    _id:           `orderonly:${normalizePhone(oc.phone)}`,
    customerId:    '',
    name:          oc.customerName || 'Guest',
    phone:         oc.phone,
    loyaltyBalance: 0,
    lifetimeSpend: oc.totalSpent,
    visitCount:    oc.totalOrders,
    lastVisitAt:   oc.lastOrderDate,
    status:        'active',
    _orderOnly:    true,
  };
}

function csvDownload(filename: string, rows: string[][]): void {
  const content = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function txTypeLabel(type: string) {
  const map: Record<string, string> = {
    earn: 'Earn', redeem: 'Redeem', adjust: 'Adjust',
    expire: 'Expired', transfer_in: 'Transfer In', transfer_out: 'Transfer Out',
  };
  return map[type] ?? type;
}

function txTypeBadge(type: string) {
  const map: Record<string, string> = {
    earn: 'text-green-700 bg-green-100',
    redeem: 'text-red-700 bg-red-100',
    adjust: 'text-amber-700 bg-amber-100',
    expire: 'text-gray-600 bg-gray-100',
    transfer_in: 'text-blue-700 bg-blue-100',
    transfer_out: 'text-purple-700 bg-purple-100',
  };
  return map[type] ?? 'text-ink/60 bg-mist';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function CustomersPage() {
  const { role }       = useAuth();
  const { settings }   = useSettings();
  const currencySymbol = settings?.currencySymbol ?? '₹';
  const isAdmin        = role === 'admin';

  const [activeTab, setActiveTab]         = useState<Tab>('customers');
  const [search, setSearch]               = useState('');
  const [statusFilter, setStatusFilter]   = useState<StatusFilter>('all');
  const [sortMode, setSortMode]           = useState<SortMode>('default');
  const [customers, setCustomers]         = useState<CustomerSummary[]>([]);
  const [total, setTotal]                 = useState(0);
  const [page, setPage]                   = useState(1);
  const [listLoading, setListLoading]     = useState(true);
  const [listError, setListError]         = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [config, setConfig]               = useState<LoyaltyConfig | null>(null);
  const [orderCustomers, setOrderCustomers] = useState<OrderCustomer[]>([]);

  // Segments tab
  const [activeSegment, setActiveSegment]     = useState<CustomerSegment>('all');
  const [segmentCustomers, setSegmentCustomers] = useState<CustomerSummary[]>([]);
  const [segmentTotal, setSegmentTotal]       = useState(0);
  const [segmentLoading, setSegmentLoading]   = useState(false);
  const [segmentPage, setSegmentPage]         = useState(1);
  const [segmentSelectedId, setSegmentSelectedId] = useState<string | null>(null);

  // Loyalty tab
  const [loyaltyStats, setLoyaltyStats]         = useState<LoyaltyStats | null>(null);
  const [loyaltyActivity, setLoyaltyActivity]   = useState<LoyaltyActivityEntry[]>([]);
  const [activityTotal, setActivityTotal]       = useState(0);
  const [activityPage, setActivityPage]         = useState(1);
  const [loyaltyLoading, setLoyaltyLoading]     = useState(false);

  const [exporting, setExporting] = useState(false);

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Customers tab data ────────────────────────────────────────────────────

  const loadCustomers = useCallback(async (q: string, pg: number, append: boolean) => {
    setListLoading(true);
    setListError(null);
    try {
      const params: Parameters<typeof searchCustomers>[0] = { page: pg, limit: 50 };
      if (q.trim()) {
        if (looksLikePhone(q)) params.phone = q.trim();
        else                   params.name  = q.trim();
      }
      const res = await searchCustomers(params);
      setTotal(res.total);
      setCustomers(prev => append ? [...prev, ...res.customers] : res.customers);
      setPage(pg);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setFeatureEnabled(false);
      else setListError(e instanceof Error ? e.message : 'Failed to load customers');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustomers('', 1, false);
    fetchLoyaltyConfig()
      .then(({ config: c }) => setConfig(c))
      .catch(() => {});
    fetchOrderCustomers()
      .then(({ customers: ocs }) => setOrderCustomers(ocs))
      .catch(() => {});
  }, [loadCustomers]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSelectedId(null);
      setCustomers([]);
      void loadCustomers(search, 1, false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, loadCustomers]);

  // ── Segments tab data ─────────────────────────────────────────────────────

  const loadSegment = useCallback(async (seg: CustomerSegment, pg: number) => {
    setSegmentLoading(true);
    try {
      const res = await searchCustomersBySegment({ segment: seg === 'all' ? undefined : seg, page: pg, limit: 50 });
      setSegmentCustomers(res.customers);
      setSegmentTotal(res.total);
      setSegmentPage(pg);
    } catch {
      // silent
    } finally {
      setSegmentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'segments') {
      setSegmentSelectedId(null);
      void loadSegment(activeSegment, 1);
    }
  }, [activeTab, activeSegment, loadSegment]);

  // ── Loyalty tab data ──────────────────────────────────────────────────────

  const loadLoyalty = useCallback(async () => {
    setLoyaltyLoading(true);
    try {
      const [stats, act] = await Promise.all([
        fetchLoyaltyStats(),
        fetchLoyaltyActivity(1, 20),
      ]);
      setLoyaltyStats(stats);
      setLoyaltyActivity(act.transactions);
      setActivityTotal(act.total);
      setActivityPage(1);
    } catch {
      // silent
    } finally {
      setLoyaltyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'loyalty') void loadLoyalty();
  }, [activeTab, loadLoyalty]);

  const loadMoreActivity = useCallback(async (pg: number) => {
    const act = await fetchLoyaltyActivity(pg, 20);
    setLoyaltyActivity(act.transactions);
    setActivityPage(pg);
  }, []);

  // ── Keyboard ──────────────────────────────────────────────────────────────

  useShortcut('F4', () => searchInputRef.current?.focus());
  useShortcut('Escape', () => {
    if (search)     { setSearch(''); searchInputRef.current?.blur(); }
    else if (selectedId) { setSelectedId(null); }
  }, !!search || !!selectedId);

  // ── Derived lists ─────────────────────────────────────────────────────────

  const loyaltyPhoneSet = useMemo(
    () => new Set(customers.map(c => normalizePhone(c.phone))),
    [customers],
  );

  const orderCustomersMap = useMemo(
    () => new Map(orderCustomers.map(oc => [normalizePhone(oc.phone), oc])),
    [orderCustomers],
  );

  const orderOnlySummaries = useMemo(
    () => orderCustomers
      .filter(oc => oc.phone && !loyaltyPhoneSet.has(normalizePhone(oc.phone)))
      .map(toOrderOnlySummary),
    [orderCustomers, loyaltyPhoneSet],
  );

  const filteredOrderOnly = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orderOnlySummaries;
    return orderOnlySummaries.filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q),
    );
  }, [orderOnlySummaries, search]);

  const visibleCustomers = useMemo(() => {
    let loyaltyList = customers;
    if (statusFilter === 'active')  loyaltyList = loyaltyList.filter(c => c.status === 'active');
    if (statusFilter === 'blocked') loyaltyList = loyaltyList.filter(c => c.status === 'blocked');
    if (sortMode === 'spend')  loyaltyList = [...loyaltyList].sort((a, b) => b.lifetimeSpend - a.lifetimeSpend);
    if (sortMode === 'visits') loyaltyList = [...loyaltyList].sort((a, b) => b.visitCount   - a.visitCount);
    const orderOnlyVisible = statusFilter === 'blocked' ? [] : filteredOrderOnly;
    return [...loyaltyList, ...orderOnlyVisible];
  }, [customers, filteredOrderOnly, statusFilter, sortMode]);

  const topByBalance = useMemo(
    () => [...customers].sort((a, b) => b.loyaltyBalance - a.loyaltyBalance).slice(0, 10),
    [customers],
  );
  const topByVisits = useMemo(
    () => [...customers].sort((a, b) => b.visitCount - a.visitCount).slice(0, 10),
    [customers],
  );

  const rewardName = config?.rewardName ?? 'Points';

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      let source: CustomerSummary[];
      let label: string;

      if (activeTab === 'segments') {
        const res = await searchCustomersBySegment({
          segment: activeSegment === 'all' ? undefined : activeSegment,
          export: true,
        });
        source = res.customers;
        label = activeSegment;
      } else {
        source = visibleCustomers;
        label = 'customers';
      }

      const rows = [
        ['Name', 'Phone', 'Orders / Visits', 'Lifetime Spend', 'Avg Bill', 'Last Visit', 'Loyalty Points', 'Status'],
        ...source.map(c => [
          c.name,
          c.phone ?? '',
          String(c.visitCount),
          String(Math.round(c.lifetimeSpend)),
          String(c.visitCount > 0 ? Math.round(c.lifetimeSpend / c.visitCount) : 0),
          c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString('en-IN') : '',
          String(c.loyaltyBalance),
          c.status ?? 'active',
        ]),
      ];
      csvDownload(`dinepos-${label}-${new Date().toLocaleDateString('en-CA')}.csv`, rows);
    } catch {
      // silent
    } finally {
      setExporting(false);
    }
  }, [activeTab, activeSegment, visibleCustomers]);

  // ── Feature gate ──────────────────────────────────────────────────────────

  if (!featureEnabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Star size={40} className="mb-3 text-ink/10" />
        <p className="text-sm font-medium text-ink/40">Loyalty program not enabled</p>
        <p className="mt-1 text-xs text-ink/25">Enable it in hotel settings to access Customers &amp; CRM.</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* ── Header / tabs / toolbar ── */}
      <div className="shrink-0 border-b border-border bg-canvas">
        {/* Tab row */}
        <div className="flex items-center border-b border-border px-5">
          {([
            { key: 'customers', label: 'Customers', Icon: Users  },
            { key: 'segments',  label: 'Segments',  Icon: Layers },
            { key: 'loyalty',   label: 'Loyalty',   Icon: Star   },
          ] as { key: Tab; label: string; Icon: React.ElementType }[]).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                activeTab === key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink/40 hover:text-ink'
              }`}
            >
              <Icon size={12} />{label}
            </button>
          ))}
          {/* Export + total count */}
          <div className="ml-auto flex items-center gap-2 pr-1">
            <button
              onClick={() => void handleExport()}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-ink/60 hover:bg-mist disabled:opacity-40 transition-colors"
            >
              <Download size={11}/>{exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            {activeTab === 'customers' && total > 0 && (
              <span className="text-[10px] text-ink/30">{total} total</span>
            )}
          </div>
        </div>

        {/* Toolbar — customers tab only */}
        {activeTab === 'customers' && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/30" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Name or phone… (F4)"
                className="h-8 w-52 rounded-lg border border-border bg-mist pl-8 pr-3 text-xs text-ink placeholder-ink/30 outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
              />
            </div>
            <div className="flex items-center gap-1">
              {(['all', 'active', 'blocked'] as StatusFilter[]).map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                    statusFilter === f ? 'bg-brand text-white' : 'bg-ink/5 text-ink/50 hover:bg-ink/10'}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="ml-2 flex items-center gap-1">
              {([
                { mode: 'default', label: 'Recent' },
                { mode: 'spend',   label: 'Top Spenders' },
                { mode: 'visits',  label: 'Repeat' },
              ] as { mode: SortMode; label: string }[]).map(({ mode, label }) => (
                <button key={mode} onClick={() => setSortMode(mode)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    sortMode === mode ? 'bg-ink text-white' : 'bg-ink/5 text-ink/50 hover:bg-ink/10'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setCustomers([]); void loadCustomers(search, 1, false); }}
              disabled={listLoading}
              className="ml-auto rounded-lg p-1.5 text-ink/30 hover:bg-ink/5 disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={13} className={listLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      {/* ── CUSTOMERS TAB ── */}
      {activeTab === 'customers' && (
        <div className="flex flex-1 overflow-hidden">
          <div className={`${selectedId ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 shrink-0 flex-col overflow-hidden border-r border-border bg-canvas`}>
            <div className="flex-1 overflow-y-auto">
              {listError && (
                <div className="border-b border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-600">{listError}</div>
              )}
              {listLoading && customers.length === 0 ? (
                <div className="flex h-48 items-center justify-center"><Spinner size="md" /></div>
              ) : visibleCustomers.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-center text-ink/30">
                  <Users size={24} className="mb-2 text-ink/15" />
                  <p className="text-sm">{search ? 'No customers found' : 'No customers yet'}</p>
                </div>
              ) : (
                visibleCustomers.map(c => (
                  <CustomerRow key={c._id} customer={c} isSelected={selectedId === c._id} onClick={() => setSelectedId(c._id)} />
                ))
              )}
              {customers.length < total && !listLoading && (
                <div className="px-4 py-3">
                  <button onClick={() => void loadCustomers(search, page + 1, true)}
                    className="w-full rounded-lg border border-border py-2 text-xs text-ink/50 hover:bg-ink/5">
                    Load more ({total - customers.length} remaining)
                  </button>
                </div>
              )}
              {listLoading && customers.length > 0 && (
                <div className="flex items-center justify-center py-3"><Spinner size="sm" /></div>
              )}
            </div>
          </div>

          <div className={`${selectedId ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-hidden bg-mist`}>
            {selectedId && (
              <button onClick={() => setSelectedId(null)}
                className="flex sm:hidden shrink-0 items-center gap-1 border-b border-border bg-canvas px-4 py-2.5 text-xs text-ink/50 hover:text-ink">
                ← Back to list
              </button>
            )}
            {selectedId?.startsWith('orderonly:') ? (
              (() => {
                const oc = orderCustomersMap.get(selectedId.slice('orderonly:'.length));
                return oc ? <OrderOnlyCustomerPanel key={selectedId} customer={oc} currencySymbol={currencySymbol} /> : null;
              })()
            ) : selectedId ? (
              <CustomerDetail
                key={selectedId}
                customerId={selectedId}
                rewardName={rewardName}
                isAdmin={isAdmin}
                currencySymbol={currencySymbol}
                onAdjusted={() => void loadCustomers(search, 1, false)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Users size={36} className="mb-3 text-ink/10" />
                <p className="text-sm text-ink/30">Select a customer to view details</p>
                <p className="mt-1 text-xs text-ink/20">Search by name or phone number</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SEGMENTS TAB ── */}
      {activeTab === 'segments' && (
        <div className="flex flex-1 overflow-hidden">
          {/* Segment sidebar */}
          <div className={`${segmentSelectedId ? 'hidden sm:flex' : 'flex'} w-full sm:w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-canvas`}>
            {SEGMENTS.map(seg => (
              <button
                key={seg.key}
                onClick={() => { setActiveSegment(seg.key); setSegmentSelectedId(null); }}
                className={`w-full text-left px-4 py-3 border-b border-border/40 transition-colors ${
                  activeSegment === seg.key ? 'bg-brand/5 border-l-2 border-l-brand' : 'hover:bg-mist'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink">
                    {seg.icon && <span className="mr-1">{seg.icon}</span>}{seg.label}
                  </span>
                </div>
                <p className="text-[10px] text-ink/40 mt-0.5">{seg.desc}</p>
              </button>
            ))}
          </div>

          {/* Segment customer list */}
          <div className={`${segmentSelectedId ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 shrink-0 flex-col overflow-hidden border-r border-border bg-canvas`}>
            <div className="px-4 py-2.5 border-b border-border bg-mist flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">
                {SEGMENTS.find(s => s.key === activeSegment)?.label}
              </span>
              <span className="text-[10px] text-ink/40">{segmentTotal} customers</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {segmentLoading ? (
                <div className="flex h-48 items-center justify-center"><Spinner size="md" /></div>
              ) : segmentCustomers.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-center text-ink/30">
                  <CheckCircle size={24} className="mb-2 text-ink/15" />
                  <p className="text-sm">No customers in this segment</p>
                </div>
              ) : (
                segmentCustomers.map(c => (
                  <CustomerRow
                    key={c._id}
                    customer={c}
                    isSelected={segmentSelectedId === c._id}
                    onClick={() => setSegmentSelectedId(c._id)}
                  />
                ))
              )}
              {segmentCustomers.length < segmentTotal && !segmentLoading && (
                <div className="px-4 py-3">
                  <button onClick={() => void loadSegment(activeSegment, segmentPage + 1)}
                    className="w-full rounded-lg border border-border py-2 text-xs text-ink/50 hover:bg-ink/5">
                    Load more ({segmentTotal - segmentCustomers.length} remaining)
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Segment detail panel */}
          <div className={`${segmentSelectedId ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-hidden bg-mist`}>
            {segmentSelectedId && (
              <button onClick={() => setSegmentSelectedId(null)}
                className="flex sm:hidden shrink-0 items-center gap-1 border-b border-border bg-canvas px-4 py-2.5 text-xs text-ink/50">
                ← Back
              </button>
            )}
            {segmentSelectedId && !segmentSelectedId.startsWith('orderonly:') ? (
              <CustomerDetail
                key={segmentSelectedId}
                customerId={segmentSelectedId}
                rewardName={rewardName}
                isAdmin={isAdmin}
                currencySymbol={currencySymbol}
                onAdjusted={() => void loadSegment(activeSegment, 1)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <AlertTriangle size={28} className="mb-3 text-ink/10" />
                <p className="text-sm text-ink/30">Select a customer from the segment</p>
                <p className="mt-1 text-xs text-ink/20">
                  {segmentTotal > 0
                    ? `${segmentTotal} customers in "${SEGMENTS.find(s => s.key === activeSegment)?.label}"`
                    : 'This segment is empty'
                  }
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LOYALTY TAB ── */}
      {activeTab === 'loyalty' && (
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Points Program config */}
          {config && (
            <div className="rounded-xl border border-border bg-canvas p-5">
              <div className="mb-4 flex items-center gap-2">
                <Star size={14} className="text-brand" />
                <h2 className="text-sm font-semibold text-ink">{rewardName} Program</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Earn rate',  value: `${config.pointsPerHundredRupees} pts / ₹100` },
                  { label: 'Min redeem', value: `${config.minimumRedeemPoints} ${rewardName}` },
                  { label: 'Max redeem', value: `${config.maximumRedeemPercent}% of bill` },
                  { label: 'Expiry',     value: config.expiryDays === 0 ? 'Never' : `${config.expiryDays} days` },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-mist px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-ink/40">{label}</p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPI cards */}
          {loyaltyLoading && !loyaltyStats ? (
            <div className="flex items-center justify-center py-12"><Spinner size="lg" /></div>
          ) : loyaltyStats && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total Members',    value: loyaltyStats.totalMembers.toLocaleString() },
                  { label: 'Active (30d)',      value: loyaltyStats.activeLast30.toLocaleString() },
                  { label: 'Points Issued',     value: loyaltyStats.pointsIssued.toLocaleString() },
                  { label: 'Points Redeemed',   value: loyaltyStats.pointsRedeemed.toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border border-border bg-canvas p-4">
                    <p className="text-[10px] uppercase tracking-wider text-ink/40">{label}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: 'Outstanding Points', value: loyaltyStats.totalOutstandingPoints.toLocaleString() },
                  { label: 'Points Expired',     value: loyaltyStats.pointsExpired.toLocaleString() },
                  { label: 'Points Adjusted',    value: loyaltyStats.pointsAdjusted.toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border border-border bg-canvas p-4">
                    <p className="text-[10px] uppercase tracking-wider text-ink/40">{label}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Top tables */}
          {listLoading && customers.length === 0 ? (
            <div className="flex items-center justify-center py-12"><Spinner size="lg" /></div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                  <Award size={14} className="text-brand" />
                  <h3 className="text-sm font-semibold text-ink">Top by {rewardName} Balance</h3>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-mist">
                      <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">#</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Customer</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Orders</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Lifetime</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">{rewardName}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {topByBalance.length === 0 ? (
                      <tr><td colSpan={5} className="px-5 py-6 text-center text-xs text-ink/30">No customers yet</td></tr>
                    ) : topByBalance.map((c, i) => (
                      <tr key={c._id}
                        onClick={() => { setActiveTab('customers'); setSelectedId(c._id); }}
                        className="cursor-pointer transition-colors hover:bg-mist">
                        <td className="px-4 py-2.5 text-xs tabular-nums text-ink/30">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <p className="text-xs font-medium text-ink">{c.name}</p>
                          <p className="text-[10px] text-ink/40">{c.phone ?? '—'}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums text-ink/60">{c.visitCount}</td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums text-ink/60">
                          {currencySymbol}{Math.round(c.lifetimeSpend).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-bold tabular-nums text-brand">
                          {c.loyaltyBalance.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border bg-canvas">
                <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                  <TrendingUp size={14} className="text-brand" />
                  <h3 className="text-sm font-semibold text-ink">Most Frequent Visitors</h3>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-mist">
                      <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">#</th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Customer</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Visits</th>
                      <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Lifetime</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {topByVisits.length === 0 ? (
                      <tr><td colSpan={4} className="px-5 py-6 text-center text-xs text-ink/30">No customers yet</td></tr>
                    ) : topByVisits.map((c, i) => (
                      <tr key={c._id}
                        onClick={() => { setActiveTab('customers'); setSelectedId(c._id); }}
                        className="cursor-pointer transition-colors hover:bg-mist">
                        <td className="px-4 py-2.5 text-xs tabular-nums text-ink/30">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <p className="text-xs font-medium text-ink">{c.name}</p>
                          <p className="text-[10px] text-ink/40">{c.phone ?? '—'}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-bold tabular-nums text-ink">{c.visitCount}</td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums text-ink/60">
                          {currencySymbol}{Math.round(c.lifetimeSpend).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Loyalty Activity log */}
          <div className="rounded-xl border border-border bg-canvas overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-ink">Recent Loyalty Activity</h3>
              <span className="text-[10px] text-ink/40">{activityTotal} transactions total</span>
            </div>
            {loyaltyActivity.length === 0 ? (
              <div className="py-8 text-center text-xs text-ink/30">No loyalty transactions yet</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-mist">
                        <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Date</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Customer</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Activity</th>
                        <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">{rewardName}</th>
                        <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-ink/40">Balance After</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink/40">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {loyaltyActivity.map(tx => {
                        const cust = typeof tx.customerId === 'object' ? tx.customerId : null;
                        return (
                          <tr key={tx._id} className="hover:bg-mist/50">
                            <td className="px-4 py-2.5 text-[11px] text-ink/40 whitespace-nowrap">
                              {new Date(tx.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </td>
                            <td className="px-4 py-2.5">
                              {cust ? (
                                <>
                                  <p className="text-xs font-medium text-ink">{cust.name}</p>
                                  <p className="text-[10px] text-ink/40">{cust.phone ?? '—'}</p>
                                </>
                              ) : (
                                <p className="text-xs text-ink/40">—</p>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${txTypeBadge(tx.transactionType)}`}>
                                {txTypeLabel(tx.transactionType)}
                              </span>
                            </td>
                            <td className={`px-4 py-2.5 text-right text-sm font-bold tabular-nums ${tx.points >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {tx.points >= 0 ? '+' : ''}{tx.points}
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs tabular-nums text-ink/60">{tx.balanceAfter}</td>
                            <td className="px-4 py-2.5 text-xs text-ink/50 max-w-[120px] truncate">{tx.remarks || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {activityTotal > loyaltyActivity.length && (
                  <div className="px-5 py-3 border-t border-border">
                    <button
                      onClick={() => void loadMoreActivity(activityPage + 1)}
                      className="w-full rounded-lg border border-border py-2 text-xs text-ink/50 hover:bg-ink/5">
                      Load more ({activityTotal - loyaltyActivity.length} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
