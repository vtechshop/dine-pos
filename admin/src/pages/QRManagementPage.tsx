import { useEffect, useState, useCallback } from 'react';
import {
  QrCode, Plus, Download, Printer, RefreshCw,
  CheckCircle2, XCircle, ToggleLeft, ToggleRight, Eye,
} from 'lucide-react';
import {
  SectionHeader, PageLoader, ErrorState, EmptyState,
  Badge, Btn, Modal, Select, ApiRequired,
} from '../components/ui';
import { fetchTables } from '../api/tables';
import type { Table } from '../api/tables';

// QR Management — table data from existing /tables endpoint.
// QR generation, tracking, analytics require the /qr backend (not yet implemented).

const QR_ENDPOINTS = [
  'GET  /qr                         — list QR codes',
  'POST /qr/generate                — generate restaurant / table QR',
  'POST /qr/bulk-generate           — bulk generate for all tables',
  'GET  /qr/:id/analytics           — per-QR scan / order / revenue stats',
  'PATCH /qr/:id/disable            — disable QR',
  'PATCH /qr/:id/enable             — enable QR',
  'PATCH /qr/:id/replace            — regenerate QR token (invalidate old)',
  'DELETE /qr/:id                   — delete QR record',
  'GET  /qr/analytics/summary       — today totals across all QRs',
];

type QRType = 'restaurant' | 'table' | 'dynamic' | 'static';

interface LocalQR {
  id:        string;
  label:     string;
  type:      QRType;
  tableId?:  string;
  tableNum?: number;
  enabled:   boolean;
  createdAt: string;
}

function makeQrDataUrl(text: string): string {
  // Encodes text as a QR SVG data-uri using the QR module path pattern
  // In production the /qr app renders real QR codes; here we show a placeholder SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="white"/>
    <text x="100" y="100" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#1C0800">QR: ${text.slice(0, 20)}</text>
    <rect x="10" y="10" width="60" height="60" fill="none" stroke="#1C0800" stroke-width="4"/>
    <rect x="20" y="20" width="40" height="40" fill="#1C0800"/>
    <rect x="130" y="10" width="60" height="60" fill="none" stroke="#1C0800" stroke-width="4"/>
    <rect x="140" y="20" width="40" height="40" fill="#1C0800"/>
    <rect x="10" y="130" width="60" height="60" fill="none" stroke="#1C0800" stroke-width="4"/>
    <rect x="20" y="140" width="40" height="40" fill="#1C0800"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export default function QRManagementPage() {
  const [tables,    setTables]    = useState<Table[]>([]);
  const [qrs,       setQrs]       = useState<LocalQR[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showModal, setShowModal] = useState(false);
  const [preview,   setPreview]   = useState<LocalQR | null>(null);
  const [type,      setType]      = useState<QRType>('restaurant');
  const [tableId,   setTableId]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetchTables()
      .then(t => { setTables(t); setLoading(false); })
      .catch(() => { setError('Failed to load tables'); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = () => {
    if (type === 'table' && !tableId) return;
    const table = tables.find(t => t._id === tableId);
    const newQr: LocalQR = {
      id:        `qr_${Date.now()}`,
      label:     type === 'table' ? `Table ${table?.number ?? '?'}` : `Restaurant QR (${type})`,
      type,
      tableId:   type === 'table' ? tableId : undefined,
      tableNum:  table?.number,
      enabled:   true,
      createdAt: new Date().toISOString(),
    };
    setQrs(prev => [newQr, ...prev]);
    setShowModal(false);
    setTableId('');
  };

  const handleBulkGenerate = () => {
    const newQrs: LocalQR[] = tables.map(t => ({
      id:       `qr_${t._id}`,
      label:    `Table ${t.number}`,
      type:     'table' as QRType,
      tableId:  t._id,
      tableNum: t.number,
      enabled:  true,
      createdAt: new Date().toISOString(),
    }));
    setQrs(newQrs);
  };

  const toggleQr = (id: string) =>
    setQrs(prev => prev.map(q => q.id === id ? { ...q, enabled: !q.enabled } : q));

  const handleDownload = (qr: LocalQR) => {
    const url = makeQrDataUrl(qr.id);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `${qr.label.replace(/\s+/g, '_')}.svg`;
    a.click();
  };

  if (loading) return <PageLoader />;
  if (error)   return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="QR Management"
        sub={`${tables.length} tables · ${qrs.length} QR codes`}
        action={
          <div className="flex gap-2">
            <Btn size="sm" onClick={handleBulkGenerate} disabled={tables.length === 0}>
              <RefreshCw size={14} />
              Bulk Generate
            </Btn>
            <Btn variant="primary" size="sm" onClick={() => setShowModal(true)}>
              <Plus size={14} />
              New QR
            </Btn>
          </div>
        }
      />

      {/* Backend required banner */}
      <ApiRequired endpoints={QR_ENDPOINTS} />

      {/* Note: the banner above is shown because the /qr backend is not yet implemented.
          The QR list below is locally generated (client-side only) and will not persist
          across refreshes until the backend is live. */}

      {qrs.length === 0 ? (
        <EmptyState
          icon={<QrCode className="h-10 w-10" />}
          title="No QR codes yet"
          sub={`Generate QR codes for your ${tables.length} tables or the entire restaurant.`}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {qrs.map(qr => (
            <div key={qr.id} className="bg-white rounded-xl border border-[#E8D5C0] p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-[#1C0800]">{qr.label}</p>
                  <p className="text-xs text-[#92745E] mt-0.5">
                    {qr.type.charAt(0).toUpperCase() + qr.type.slice(1)} · {new Date(qr.createdAt).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <Badge label={qr.enabled ? 'Active' : 'Disabled'} variant={qr.enabled ? 'green' : 'gray'} />
              </div>

              {/* QR preview (SVG placeholder) */}
              <div className="flex justify-center border border-[#E8D5C0] rounded-lg p-3 bg-[#FFF6EE]">
                <img src={makeQrDataUrl(qr.id)} alt="QR" className="h-24 w-24" />
              </div>

              <div className="text-xs text-[#92745E] font-mono bg-[#FFF6EE] rounded px-2 py-1 truncate">
                ID: {qr.id}
              </div>

              <div className="flex flex-wrap gap-2">
                <Btn size="sm" onClick={() => setPreview(qr)}>
                  <Eye size={12} /> Preview
                </Btn>
                <Btn size="sm" onClick={() => handleDownload(qr)}>
                  <Download size={12} /> PNG
                </Btn>
                <Btn size="sm" onClick={() => window.print()}>
                  <Printer size={12} /> Print
                </Btn>
                <Btn
                  size="sm"
                  variant={qr.enabled ? 'ghost' : 'secondary'}
                  onClick={() => toggleQr(qr.id)}
                >
                  {qr.enabled
                    ? <><ToggleRight size={12} className="text-green-600" /> Disable</>
                    : <><ToggleLeft  size={12} className="text-gray-400" />  Enable</>
                  }
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* QR analytics columns (requires backend) */}
      {qrs.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#FFF6EE] border-b border-[#E8D5C0]">
                {['QR ID', 'Label', 'Type', 'Status', 'Created', 'Last Scan*', 'Today Scans*', 'Total Orders*', 'Revenue*'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {qrs.map(qr => (
                <tr key={qr.id} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE]">
                  <td className="px-4 py-3 font-mono text-xs text-[#92745E]">{qr.id.slice(-8)}</td>
                  <td className="px-4 py-3 font-semibold text-[#1C0800]">{qr.label}</td>
                  <td className="px-4 py-3"><Badge label={qr.type} variant="blue" /></td>
                  <td className="px-4 py-3">
                    {qr.enabled
                      ? <span className="flex items-center gap-1 text-green-700"><CheckCircle2 size={12} /> Active</span>
                      : <span className="flex items-center gap-1 text-gray-400"><XCircle size={12} /> Disabled</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-[#92745E]">{new Date(qr.createdAt).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3 text-amber-600 text-xs">Requires /qr API</td>
                  <td className="px-4 py-3 text-amber-600 text-xs">Requires /qr API</td>
                  <td className="px-4 py-3 text-amber-600 text-xs">Requires /qr API</td>
                  <td className="px-4 py-3 text-amber-600 text-xs">Requires /qr API</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-[#92745E] px-4 py-2">* Columns marked with * require the /qr backend endpoint</p>
        </div>
      )}

      {/* Generate modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Generate QR Code">
        <div className="space-y-4">
          <Select label="QR Type" value={type} onChange={e => setType(e.target.value as QRType)}>
            <option value="restaurant">Restaurant (menu landing)</option>
            <option value="table">Table QR</option>
            <option value="dynamic">Dynamic (rotating token)</option>
            <option value="static">Static (permanent link)</option>
          </Select>
          {type === 'table' && (
            <Select label="Assign to Table" value={tableId} onChange={e => setTableId(e.target.value)}>
              <option value="">Select table…</option>
              {tables.map(t => (
                <option key={t._id} value={t._id}>Table {t.number} — {t.name || t.section}</option>
              ))}
            </Select>
          )}
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            QR codes are generated client-side. They will not persist across refreshes until the
            <span className="font-mono"> POST /qr/generate</span> endpoint is implemented.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Btn onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={handleGenerate} disabled={type === 'table' && !tableId}>
              Generate QR
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Preview modal */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.label ?? 'QR Preview'}>
        {preview && (
          <div className="flex flex-col items-center gap-4">
            <div className="border-2 border-[#E8D5C0] rounded-xl p-6 bg-white">
              <img src={makeQrDataUrl(preview.id)} alt="QR" className="h-48 w-48" />
            </div>
            <p className="text-xs text-[#92745E] font-mono">{preview.id}</p>
            <div className="flex gap-2">
              <Btn onClick={() => handleDownload(preview)}>
                <Download size={14} /> Download PNG
              </Btn>
              <Btn onClick={() => window.print()}>
                <Printer size={14} /> Print
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
