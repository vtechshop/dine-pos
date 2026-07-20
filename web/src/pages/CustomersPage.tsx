import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, RefreshCw, Users, Star, Award, TrendingUp } from 'lucide-react';
import type { CustomerSummary, LoyaltyConfig } from '../types/customers';
import { searchCustomers, fetchLoyaltyConfig } from '../api/loyalty';
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

type Tab          = 'customers' | 'loyalty';
type StatusFilter = 'all' | 'active' | 'blocked';
type SortMode     = 'default' | 'spend' | 'visits';

function looksLikePhone(q: string): boolean {
  return /^[+\d\s\-()]{6,}$/.test(q.trim());
}

/** Last 10 digits of any phone string — used to deduplicate across sources. */
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

/** Convert an order-aggregated customer into a CustomerSummary shape for rendering. */
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

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

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
      if (e instanceof ApiError && e.status === 403) {
        setFeatureEnabled(false);
      } else {
        setListError(e instanceof Error ? e.message : 'Failed to load customers');
      }
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustomers('', 1, false);
    fetchLoyaltyConfig()
      .then(({ config: c }) => setConfig(c))
      .catch(() => {});
    // Silently fetch order-aggregated customers (requireAdmin — 403 for cashiers is expected).
    fetchOrderCustomers()
      .then(({ customers: ocs }) => setOrderCustomers(ocs))
      .catch(() => {});
  }, [loadCustomers]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSelectedId(null);
      setCustomers([]);
      void loadCustomers(search, 1, false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, loadCustomers]);

  // ── Keyboard ─────────────────────────────────────────────────────────────────

  useShortcut('F4', () => searchInputRef.current?.focus());
  useShortcut('Escape', () => {
    if (search)     { setSearch(''); searchInputRef.current?.blur(); }
    else if (selectedId) { setSelectedId(null); }
  }, !!search || !!selectedId);

  // ── Derived lists ─────────────────────────────────────────────────────────────

  // Phones seen in the loyalty list (all pages loaded so far) — used for dedup.
  const loyaltyPhoneSet = useMemo(
    () => new Set(customers.map(c => normalizePhone(c.phone))),
    [customers],
  );

  // Map from normalised phone → raw order record — used for detail panel lookup.
  const orderCustomersMap = useMemo(
    () => new Map(orderCustomers.map(oc => [normalizePhone(oc.phone), oc])),
    [orderCustomers],
  );

  // Order customers whose phone has no loyalty profile yet.
  const orderOnlySummaries = useMemo(
    () => orderCustomers
      .filter(oc => oc.phone && !loyaltyPhoneSet.has(normalizePhone(oc.phone)))
      .map(toOrderOnlySummary),
    [orderCustomers, loyaltyPhoneSet],
  );

  // Client-side filter of order-only records when the search box is active.
  const filteredOrderOnly = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orderOnlySummaries;
    return orderOnlySummaries.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q),
    );
  }, [orderOnlySummaries, search]);

  const visibleCustomers = useMemo(() => {
    let loyaltyList = customers;
    if (statusFilter === 'active')  loyaltyList = loyaltyList.filter(c => c.status === 'active');
    if (statusFilter === 'blocked') loyaltyList = loyaltyList.filter(c => c.status === 'blocked');
    if (sortMode === 'spend')  loyaltyList = [...loyaltyList].sort((a, b) => b.lifetimeSpend - a.lifetimeSpend);
    if (sortMode === 'visits') loyaltyList = [...loyaltyList].sort((a, b) => b.visitCount   - a.visitCount);
    // Blocked filter: order-only customers have no blocked state, exclude them
    const orderOnlyVisible = statusFilter === 'blocked' ? [] : filteredOrderOnly;
    return [...loyaltyList, ...orderOnlyVisible];
  }, [customers, filteredOrderOnly, statusFilter, sortMode]);

  // Loyalty tab: sort the same loaded batch client-side
  const topByBalance = useMemo(
    () => [...customers].sort((a, b) => b.loyaltyBalance - a.loyaltyBalance).slice(0, 10),
    [customers],
  );
  const topByVisits = useMemo(
    () => [...customers].sort((a, b) => b.visitCount - a.visitCount).slice(0, 10),
    [customers],
  );

  const rewardName = config?.rewardName ?? 'Points';

  // ── Feature gate ──────────────────────────────────────────────────────────────

  if (!featureEnabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Star size={40} className="mb-3 text-[#1C0800]/10" />
        <p className="text-sm font-medium text-[#1C0800]/40">Loyalty program not enabled</p>
        <p className="mt-1 text-xs text-[#1C0800]/25">
          Enable it in hotel settings to access Customers &amp; CRM.
        </p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* ── Header / tabs / toolbar ── */}
      <div className="shrink-0 border-b border-[#E8D5C0] bg-white">
        {/* Tab row */}
        <div className="flex items-center border-b border-[#E8D5C0] px-5">
          {(['customers', 'loyalty'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-semibold capitalize transition-colors ${
                activeTab === tab
                  ? 'border-[#E8380D] text-[#E8380D]'
                  : 'border-transparent text-[#1C0800]/40 hover:text-[#1C0800]'
              }`}
            >
              {tab === 'customers'
                ? <><Users size={12} />Customers</>
                : <><Star  size={12} />Loyalty</>
              }
            </button>
          ))}
          <span className="ml-auto pr-1 text-[10px] text-[#1C0800]/30">
            {total > 0 ? `${total} total` : ''}
          </span>
        </div>

        {/* Toolbar — customers tab only */}
        {activeTab === 'customers' && (
          <div className="flex items-center gap-2 px-4 py-2.5">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#1C0800]/30" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Name or phone… (F4)"
                className="h-8 w-52 rounded-lg border border-[#E8D5C0] bg-[#FFF6EE] pl-8 pr-3 text-xs text-[#1C0800] placeholder-[#1C0800]/30 outline-none focus:border-[#E8380D]/50 focus:ring-1 focus:ring-[#E8380D]/20"
              />
            </div>

            <div className="flex items-center gap-1">
              {(['all', 'active', 'blocked'] as StatusFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                    statusFilter === f
                      ? 'bg-[#E8380D] text-white'
                      : 'bg-[#1C0800]/5 text-[#1C0800]/50 hover:bg-[#1C0800]/10'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="ml-2 flex items-center gap-1">
              {([
                { mode: 'default', label: 'Recent'       },
                { mode: 'spend',   label: 'Top Spenders' },
                { mode: 'visits',  label: 'Repeat'       },
              ] as { mode: SortMode; label: string }[]).map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    sortMode === mode
                      ? 'bg-[#1C0800] text-white'
                      : 'bg-[#1C0800]/5 text-[#1C0800]/50 hover:bg-[#1C0800]/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => { setCustomers([]); void loadCustomers(search, 1, false); }}
              disabled={listLoading}
              className="ml-auto rounded-lg p-1.5 text-[#1C0800]/30 hover:bg-[#1C0800]/5 disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={13} className={listLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {activeTab === 'customers' ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel: customer list */}
          <div className="flex w-80 shrink-0 flex-col overflow-hidden border-r border-[#E8D5C0] bg-white">
            <div className="flex-1 overflow-y-auto">
              {listError && (
                <div className="border-b border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-600">
                  {listError}
                </div>
              )}

              {listLoading && customers.length === 0 ? (
                <div className="flex h-48 items-center justify-center">
                  <Spinner size="md" />
                </div>
              ) : visibleCustomers.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-center text-[#1C0800]/30">
                  <Users size={24} className="mb-2 text-[#1C0800]/15" />
                  <p className="text-sm">
                    {search ? 'No customers found' : 'No customers yet'}
                  </p>
                </div>
              ) : (
                visibleCustomers.map(c => (
                  <CustomerRow
                    key={c._id}
                    customer={c}
                    isSelected={selectedId === c._id}
                    onClick={() => setSelectedId(c._id)}
                  />
                ))
              )}

              {customers.length < total && !listLoading && (
                <div className="px-4 py-3">
                  <button
                    onClick={() => void loadCustomers(search, page + 1, true)}
                    className="w-full rounded-lg border border-[#E8D5C0] py-2 text-xs text-[#1C0800]/50 hover:bg-[#1C0800]/5"
                  >
                    Load more ({total - customers.length} remaining)
                  </button>
                </div>
              )}

              {listLoading && customers.length > 0 && (
                <div className="flex items-center justify-center py-3">
                  <Spinner size="sm" />
                </div>
              )}
            </div>
          </div>

          {/* Right panel: detail */}
          <div className="flex flex-1 flex-col overflow-hidden bg-[#FFF6EE]">
            {selectedId?.startsWith('orderonly:') ? (
              (() => {
                const oc = orderCustomersMap.get(selectedId.slice('orderonly:'.length));
                return oc ? (
                  <OrderOnlyCustomerPanel
                    key={selectedId}
                    customer={oc}
                    currencySymbol={currencySymbol}
                  />
                ) : null;
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
                <Users size={36} className="mb-3 text-[#1C0800]/10" />
                <p className="text-sm text-[#1C0800]/30">Select a customer to view details</p>
                <p className="mt-1 text-xs text-[#1C0800]/20">Search by name or phone number</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Loyalty tab ── */
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Config card */}
          {config && (
            <div className="rounded-xl border border-[#E8D5C0] bg-white p-5">
              <div className="mb-4 flex items-center gap-2">
                <Star size={14} className="text-[#E8380D]" />
                <h2 className="text-sm font-semibold text-[#1C0800]">
                  {rewardName} Program
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Earn rate',   value: `${config.pointsPerHundredRupees} pts / ₹100` },
                  { label: 'Min redeem',  value: `${config.minimumRedeemPoints} ${rewardName}` },
                  { label: 'Max redeem',  value: `${config.maximumRedeemPercent}% of bill` },
                  { label: 'Expiry',      value: config.expiryDays === 0 ? 'Never' : `${config.expiryDays} days` },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-[#FFF6EE] px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-[#1C0800]/40">{label}</p>
                    <p className="mt-0.5 text-sm font-semibold text-[#1C0800]">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {listLoading && customers.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Top Customers */}
              <div className="overflow-hidden rounded-xl border border-[#E8D5C0] bg-white">
                <div className="flex items-center gap-2 border-b border-[#E8D5C0] px-5 py-3">
                  <Award size={14} className="text-[#E8380D]" />
                  <h3 className="text-sm font-semibold text-[#1C0800]">
                    Top by {rewardName} Balance
                  </h3>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-[#FFF6EE]">
                      <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#1C0800]/40">#</th>
                      <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#1C0800]/40">Customer</th>
                      <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-[#1C0800]/40">{rewardName}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8D5C0]">
                    {topByBalance.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-6 text-center text-xs text-[#1C0800]/30">
                          No customers yet
                        </td>
                      </tr>
                    ) : topByBalance.map((c, i) => (
                      <tr
                        key={c._id}
                        onClick={() => { setActiveTab('customers'); setSelectedId(c._id); }}
                        className="cursor-pointer transition-colors hover:bg-[#FFF6EE]"
                      >
                        <td className="px-5 py-2.5 text-xs tabular-nums text-[#1C0800]/30">{i + 1}</td>
                        <td className="px-5 py-2.5">
                          <p className="text-xs font-medium text-[#1C0800]">{c.name}</p>
                          <p className="text-[10px] text-[#1C0800]/40">{c.phone ?? '—'}</p>
                        </td>
                        <td className="px-5 py-2.5 text-right text-sm font-bold tabular-nums text-[#E8380D]">
                          {c.loyaltyBalance.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Repeat Customers */}
              <div className="overflow-hidden rounded-xl border border-[#E8D5C0] bg-white">
                <div className="flex items-center gap-2 border-b border-[#E8D5C0] px-5 py-3">
                  <TrendingUp size={14} className="text-[#E8380D]" />
                  <h3 className="text-sm font-semibold text-[#1C0800]">Most Frequent Visitors</h3>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-[#FFF6EE]">
                      <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#1C0800]/40">#</th>
                      <th className="px-5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#1C0800]/40">Customer</th>
                      <th className="px-5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-[#1C0800]/40">Visits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8D5C0]">
                    {topByVisits.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-6 text-center text-xs text-[#1C0800]/30">
                          No customers yet
                        </td>
                      </tr>
                    ) : topByVisits.map((c, i) => (
                      <tr
                        key={c._id}
                        onClick={() => { setActiveTab('customers'); setSelectedId(c._id); }}
                        className="cursor-pointer transition-colors hover:bg-[#FFF6EE]"
                      >
                        <td className="px-5 py-2.5 text-xs tabular-nums text-[#1C0800]/30">{i + 1}</td>
                        <td className="px-5 py-2.5">
                          <p className="text-xs font-medium text-[#1C0800]">{c.name}</p>
                          <p className="text-[10px] text-[#1C0800]/40">{c.phone ?? '—'}</p>
                        </td>
                        <td className="px-5 py-2.5 text-right text-sm font-bold tabular-nums text-[#1C0800]">
                          {c.visitCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
