import { useState, useEffect, useCallback } from 'react';
import { Sunrise, RefreshCw, ChevronDown, AlertTriangle, CalendarDays } from 'lucide-react';
import { MorningBriefCard } from '../../components/ai/MorningBriefCard';
import {
  fetchLatestBrief,
  fetchBriefByDate,
  fetchBriefHistory,
  type MorningBrief,
  type BriefHistoryItem,
} from '../../api/morningBrief';
import { apiFetch } from '../../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

function gradeClasses(g: string): string {
  const map: Record<string, string> = {
    A: 'text-green-600 bg-green-50 border-green-200',
    B: 'text-blue-600 bg-blue-50 border-blue-200',
    C: 'text-yellow-600 bg-yellow-50 border-yellow-200',
    D: 'text-orange-500 bg-orange-50 border-orange-200',
    F: 'text-red-600 bg-red-50 border-red-200',
  };
  return map[g] ?? 'text-ink/60 bg-mist border-border';
}

// ── History sidebar item ──────────────────────────────────────────────────────

function HistoryItem({
  item, selected, onClick,
}: { item: BriefHistoryItem; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
        selected ? 'border-brand/30 bg-brand/5' : 'border-transparent hover:bg-mist'
      }`}
    >
      <div className="mb-0.5 flex items-center justify-between gap-1">
        <span className="truncate text-xs font-semibold text-ink">{fmtDate(item.date)}</span>
        <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold ${gradeClasses(item.business.healthGrade)}`}>
          {item.business.healthGrade}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-ink/60">
          ₹{Math.round(item.business.revenue).toLocaleString('en-IN')}
        </span>
        {item.warning && <AlertTriangle size={9} className="shrink-0 text-amber-500" />}
      </div>
    </button>
  );
}

// ── Loading skeleton (MorningBriefCard requires a valid brief object,
//    so we render our own skeleton rather than using its loading prop) ──────────

function BriefSkeleton() {
  return (
    <div className="animate-pulse space-y-3 rounded-xl border border-border bg-canvas p-5">
      <div className="h-4 w-44 rounded bg-border" />
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-border" />)}
      </div>
      <div className="h-16 rounded-lg bg-border" />
      <div className="h-4 w-52 rounded bg-border" />
    </div>
  );
}

// ── History list (shared between sidebar and mobile dropdown) ─────────────────

function HistoryList({
  items, loading, selectedDate, onSelect,
}: {
  items: BriefHistoryItem[];
  loading: boolean;
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-1.5 p-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-border" />
        ))}
      </div>
    );
  }
  if (!items.length) {
    return <p className="p-3 text-xs text-ink/40">No previous briefs</p>;
  }
  return (
    <div className="space-y-0.5 p-1.5">
      {items.map((item) => (
        <HistoryItem
          key={item._id}
          item={item}
          selected={item.date === selectedDate}
          onClick={() => onSelect(item.date)}
        />
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function MorningBriefPage() {
  const [brief, setBrief]               = useState<MorningBrief | null>(null);
  const [history, setHistory]           = useState<BriefHistoryItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [histLoading, setHistLoading]   = useState(true);
  const [regenLoading, setRegenLoading] = useState(false);
  const [mobileOpen, setMobileOpen]     = useState(false);

  // Load history once on mount
  useEffect(() => {
    fetchBriefHistory(30)
      .then((r) => setHistory(r.briefs))
      .catch(() => setHistory([]))
      .finally(() => setHistLoading(false));
  }, []);

  // Load a brief (latest or by date)
  const loadBrief = useCallback(async (date?: string) => {
    setLoading(true);
    setError(null);
    try {
      const b = date ? await fetchBriefByDate(date) : await fetchLatestBrief();
      // Guard against 202 / empty response — b._id absent means no brief yet
      if (b?._id) {
        setBrief(b);
        setSelectedDate(b.date);
      } else {
        setBrief(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load brief');
      setBrief(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadBrief(); }, [loadBrief]);

  const handleSelectDate = useCallback((date: string) => {
    setMobileOpen(false);
    void loadBrief(date);
  }, [loadBrief]);

  const handleRegen = useCallback(async () => {
    if (regenLoading) return;
    setRegenLoading(true);
    try {
      await apiFetch<unknown>('/ai/morning-brief/regenerate', {
        method: 'POST',
        body: JSON.stringify({ date: selectedDate }),
      });
      await loadBrief(selectedDate ?? undefined);
      // Refresh sidebar history after regeneration
      fetchBriefHistory(30).then((r) => setHistory(r.briefs)).catch(() => {});
    } catch {
      // Brief stays; silently ignore regen errors
    } finally {
      setRegenLoading(false);
    }
  }, [regenLoading, selectedDate, loadBrief]);

  const displayDate = brief?.date ?? selectedDate;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Sunrise size={18} className="shrink-0 text-brand" />
            <div>
              <h1 className="text-sm font-semibold text-ink">Morning Brief</h1>
              {displayDate && (
                <p className="text-[11px] text-ink/40">{fmtDate(displayDate)}</p>
              )}
            </div>
          </div>
          <button
            onClick={() => { void handleRegen(); }}
            disabled={regenLoading || loading}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-mist disabled:opacity-50"
          >
            <RefreshCw size={12} className={regenLoading ? 'animate-spin' : ''} />
            Regenerate
          </button>
        </div>
      </div>

      {/* ── Mobile date selector (hidden on lg+) ────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-2 lg:hidden">
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-mist"
        >
          <div className="flex items-center gap-2">
            <CalendarDays size={13} className="text-ink/40" />
            <span className="text-xs text-ink/60">Browse history</span>
          </div>
          <ChevronDown
            size={13}
            className={`text-ink/40 transition-transform ${mobileOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {mobileOpen && (
          <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-border bg-canvas">
            <HistoryList
              items={history}
              loading={histLoading}
              selectedDate={selectedDate}
              onSelect={handleSelectDate}
            />
          </div>
        )}
      </div>

      {/* ── Body: sidebar + main ────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar — desktop only */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-canvas lg:flex">
          <div className="shrink-0 border-b border-border px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/40">History</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <HistoryList
              items={history}
              loading={histLoading}
              selectedDate={selectedDate}
              onSelect={handleSelectDate}
            />
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <BriefSkeleton />
          ) : error ? (
            <div className="rounded-xl border border-border bg-canvas p-8 text-center">
              <AlertTriangle size={24} className="mx-auto mb-3 text-amber-400" />
              <p className="mb-3 text-sm text-ink/60">{error}</p>
              <button
                onClick={() => { void loadBrief(selectedDate ?? undefined); }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-mist"
              >
                Retry
              </button>
            </div>
          ) : brief ? (
            <div className="rounded-xl border border-border bg-canvas overflow-hidden">
              <MorningBriefCard brief={brief} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-canvas p-12 text-center">
              <Sunrise size={36} className="mb-3 text-brand/30" />
              <h2 className="mb-1.5 text-sm font-semibold text-ink">No brief available yet</h2>
              <p className="max-w-xs text-xs leading-relaxed text-ink/50">
                Briefs are generated daily at 4:00–6:00 AM UTC. Check back tomorrow.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
