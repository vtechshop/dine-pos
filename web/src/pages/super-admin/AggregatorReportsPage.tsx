// Aggregator Reports — CSV downloads
// Data: GET /superadmin/aggregator/reports/generate?type=&from=&to=&format=csv

import { useState } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { SAPageHeader } from '../../components/ui/SAShared';
import { getAggReport } from '../../api/saAggregator';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const REPORT_TYPES = [
  { type: 'revenue',      label: 'Sales',        desc: 'Sales, commission and net amount per platform per hotel' },
  { type: 'commission',   label: 'Commission',   desc: 'Commission charged by Swiggy and Zomato' },
  { type: 'cancellation', label: 'Cancellations', desc: 'Cancelled orders with reasons and lost sales' },
  { type: 'refund',       label: 'Refunds',      desc: 'Refunds by hotel, platform and amount' },
  { type: 'menu-sync',    label: 'Menu Sync',    desc: 'Menu sync history per hotel' },
  { type: 'webhook',      label: 'Webhooks',     desc: 'Order messages received from Swiggy and Zomato' },
  { type: 'aggregator',   label: 'Full Report',  desc: 'All of the above in one file' },
];

export function AggregatorReportsPage() {
  const [from,        setFrom]        = useState(daysAgo(7));
  const [to,          setTo]          = useState(today());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [errors,      setErrors]      = useState<Record<string, string>>({});

  const download = async (type: string) => {
    setDownloading(type);
    setErrors(prev => ({ ...prev, [type]: '' }));
    try {
      const blob = await getAggReport(type, from, to);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `aggregator-${type}-${from}-to-${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setErrors(prev => ({ ...prev, [type]: "Couldn't download this report. Please try again." }));
    } finally {
      setDownloading(null);
    }
  };

  const badRange = !from || !to || from > to;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <SAPageHeader
        title="Aggregator Reports"
        sub="Download Swiggy & Zomato reports as CSV files"
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Date range */}
        <div className="flex items-end gap-3">
          <div>
            <p className="text-xs font-semibold text-ink/50 mb-1">From</p>
            <input type="date" value={from} max={to || today()} onChange={e => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
          </div>
          <div>
            <p className="text-xs font-semibold text-ink/50 mb-1">To</p>
            <input type="date" value={to} min={from} max={today()} onChange={e => setTo(e.target.value)}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink focus:outline-none" />
          </div>
          {badRange && (
            <p className="pb-2 text-xs text-red-600">Pick a valid date range.</p>
          )}
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
                    <p className="text-[11px] text-red-600 mt-1">{errors[rt.type]}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => void download(rt.type)}
                disabled={downloading !== null || badRange}
                className="flex items-center gap-1.5 shrink-0 rounded-lg border border-border bg-canvas px-3 py-2 text-xs font-semibold text-ink/70 hover:bg-mist disabled:opacity-50 transition"
              >
                {downloading === rt.type
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <Download size={12} />
                }
                {downloading === rt.type ? 'Downloading…' : 'CSV'}
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-ink/40 bg-mist border border-border rounded-lg px-4 py-3">
          Reports never include Swiggy or Zomato passwords or keys.
        </p>
      </div>
    </div>
  );
}
