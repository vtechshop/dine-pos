// M13 — Aggregator Reports
// Requires: GET /superadmin/aggregator/reports/generate?type=&from=&to=&format=

import { useState } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import {
  ApiRequired, SAPageHeader,
} from '../../components/ui/SAShared';
import { getAggReport } from '../../api/saAggregator';

const REPORTS_ENDPOINTS = [
  'GET /superadmin/aggregator/reports/generate?type=revenue&from=&to=&format=csv     — revenue report',
  'GET /superadmin/aggregator/reports/generate?type=settlement&from=&to=&format=csv  — settlement report',
  'GET /superadmin/aggregator/reports/generate?type=commission&from=&to=&format=csv  — commission report',
  'GET /superadmin/aggregator/reports/generate?type=cancellation&from=&to=&format=csv — cancellation report',
  'GET /superadmin/aggregator/reports/generate?type=refund&from=&to=&format=csv      — refund report',
  'GET /superadmin/aggregator/reports/generate?type=menu-sync&from=&to=&format=csv   — menu sync history report',
  'GET /superadmin/aggregator/reports/generate?type=webhook&from=&to=&format=csv     — webhook delivery report',
  'GET /superadmin/aggregator/reports/generate?type=aggregator&from=&to=&format=csv  — full aggregator report',
];

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const REPORT_TYPES = [
  { type: 'revenue',      label: 'Revenue',      desc: 'Total revenue, commission, net per platform per hotel' },
  { type: 'settlement',   label: 'Settlement',   desc: 'Official settlement figures with GST breakdown' },
  { type: 'commission',   label: 'Commission',   desc: 'Platform commission breakdown by Swiggy/Zomato' },
  { type: 'cancellation', label: 'Cancellation', desc: 'Cancelled orders with reasons and lost revenue' },
  { type: 'refund',       label: 'Refunds',      desc: 'Refund register with hotel, platform, and amount' },
  { type: 'menu-sync',    label: 'Menu Sync',    desc: 'Menu sync history — success/fail/retry per hotel' },
  { type: 'webhook',      label: 'Webhooks',     desc: 'Webhook delivery log — latency, failures, retries' },
  { type: 'aggregator',   label: 'Full Report',  desc: 'All of the above combined in a single export' },
];

export function AggregatorReportsPage() {
  const [from,       setFrom]       = useState(daysAgo(7));
  const [to,         setTo]         = useState(today());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [errors,     setErrors]     = useState<Record<string, string>>({});

  const download = async (type: string) => {
    setDownloading(type);
    setErrors(prev => ({ ...prev, [type]: '' }));
    try {
      const blob = await getAggReport(type, from, to);
      const url  = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `sa_${type}_${from}_${to}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrors(prev => ({ ...prev, [type]: e instanceof Error ? e.message : 'Download failed' }));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Aggregator Reports"
        sub="Download aggregator, revenue, settlement, commission, cancellation, and webhook reports"
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        <ApiRequired endpoints={REPORTS_ENDPOINTS} />

        {/* Date range */}
        <div className="flex items-center gap-3">
          <div>
            <p className="text-xs font-semibold text-ink/50 mb-1">From</p>
            <input type="date" value={from} max={today()} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
          </div>
          <div>
            <p className="text-xs font-semibold text-ink/50 mb-1">To</p>
            <input type="date" value={to}   max={today()} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
          </div>
        </div>

        {/* Report cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {REPORT_TYPES.map(rt => (
            <div key={rt.type} className="rounded-xl border border-border bg-canvas p-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-mist flex items-center justify-center shrink-0">
                  <FileText size={16} className="text-ink/40" />
                </div>
                <div>
                  <p className="font-bold text-ink">{rt.label}</p>
                  <p className="text-xs text-ink/50 mt-0.5">{rt.desc}</p>
                  {errors[rt.type] && (
                    <p className="text-[10px] text-red-600 mt-1 font-mono">{errors[rt.type]}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => void download(rt.type)}
                disabled={downloading === rt.type}
                className="flex items-center gap-1.5 shrink-0 rounded-lg border border-border bg-canvas px-3 py-2 text-xs font-semibold text-ink/70 hover:bg-mist disabled:opacity-50 transition"
              >
                {downloading === rt.type
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <Download size={12} />
                }
                CSV
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-ink/40 bg-mist border border-border rounded-lg px-4 py-3">
          All reports above require <span className="font-mono">GET /superadmin/aggregator/reports/generate</span> to be implemented
          in the backend. Downloads will return an error until the endpoint exists.
          Credentials are never included in any export — encrypted at rest and never exposed via API.
        </p>
      </div>
    </div>
  );
}
