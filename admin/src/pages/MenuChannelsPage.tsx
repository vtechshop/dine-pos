import { useEffect, useState, useCallback } from 'react';
import { Package, Search, RefreshCw } from 'lucide-react';
import {
  SectionHeader, PageLoader, ErrorState, EmptyState, Btn, ApiRequired,
} from '../components/ui';
import { fetchProducts, fetchCategories } from '../api/products';
import type { Product, Category } from '../api/products';

// Menu Channel Management
// The /products endpoint returns the base POS price & availability.
// Channel-specific pricing (Swiggy price, Zomato price, Website price, QR price)
// requires per-product channel configuration which is NOT yet implemented in the backend.

const CHANNEL_ENDPOINTS = [
  'GET  /products/:id/channels           — channel pricing & availability',
  'PUT  /products/:id/channels/:channel  — update channel price / availability / image / description',
  'POST /products/channels/bulk-sync     — sync all channel prices at once',
];

type Channel = 'pos' | 'website' | 'qr' | 'swiggy' | 'zomato';
const CHANNELS: { key: Channel; label: string; color: string }[] = [
  { key: 'pos',     label: 'POS',     color: '#E8380D' },
  { key: 'website', label: 'Website', color: '#3B82F6' },
  { key: 'qr',      label: 'QR',      color: '#10B981' },
  { key: 'swiggy',  label: 'Swiggy',  color: '#FC8019' },
  { key: 'zomato',  label: 'Zomato',  color: '#E23744' },
];

function catName(cat: string | Category): string {
  return typeof cat === 'object' ? cat.name : cat;
}

export default function MenuChannelsPage() {
  const [products,   setProducts]   = useState<Product[]>([]);
  const [, setCategories] = useState<Category[]>([]);
  const [search,     setSearch]     = useState('');
  const [catFilter,  setCatFilter]  = useState('all');
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([fetchProducts(), fetchCategories()]).then(([p, c]) => {
      if (p.status === 'fulfilled') setProducts(p.value);
      if (c.status === 'fulfilled') setCategories(c.value);
      if (p.status === 'rejected')  setError('Failed to load products');
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchCat    = catFilter === 'all' || catName(p.category) === catFilter;
    return matchSearch && matchCat;
  });

  const catNames = Array.from(new Set(products.map(p => catName(p.category)))).filter(Boolean);

  if (loading) return <PageLoader />;
  if (error)   return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Channel Pricing"
        sub={`${products.length} products · configure per-channel prices & availability`}
        action={
          <div className="flex gap-2">
            <Btn size="sm" disabled title="Requires POST /products/channels/bulk-sync">
              Bulk Sync All
            </Btn>
            <Btn size="sm" onClick={load}><RefreshCw size={14} /></Btn>
          </div>
        }
      />

      <ApiRequired endpoints={CHANNEL_ENDPOINTS} />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#C4A090]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="pl-9 pr-4 py-2 rounded-lg border border-[#E8D5C0] text-sm text-[#1C0800] placeholder-[#C4A090] focus:outline-none focus:border-[#E8380D] bg-white"
          />
        </div>
        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          className="rounded-lg border border-[#E8D5C0] px-3 py-2 text-sm text-[#1C0800] bg-white focus:outline-none focus:border-[#E8380D]"
        >
          <option value="all">All categories</option>
          {catNames.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Product table with channel columns */}
      {visible.length === 0 ? (
        <EmptyState icon={<Package className="h-10 w-10" />} title="No products" sub="Add products from the POS app." />
      ) : (
        <div className="bg-white rounded-xl border border-[#E8D5C0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#FFF6EE] border-b border-[#E8D5C0]">
                <th className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide">Product</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide">Category</th>
                {CHANNELS.map(ch => (
                  <th key={ch.key} className="text-center px-3 py-3 text-xs font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: ch.color }}>
                    {ch.label}
                  </th>
                ))}
                <th className="text-left px-4 py-3 text-xs font-bold text-[#92745E] uppercase tracking-wide">Sync</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => (
                <tr key={p._id} className="border-b border-[#F5E8DB] hover:bg-[#FFF6EE]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{p.isVeg ? '🟢' : '🔴'}</span>
                      <span className="font-semibold text-[#1C0800]">{p.name}</span>
                      {!p.isAvailable && <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5 font-bold">Unavail</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#92745E] text-xs">{catName(p.category)}</td>
                  {/* POS price — live data */}
                  <td className="px-3 py-3 text-center">
                    <span className="font-bold text-[#E8380D]">₹{p.price}</span>
                  </td>
                  {/* Other channels — backend required */}
                  {(['website', 'qr', 'swiggy', 'zomato'] as Channel[]).map(ch => (
                    <td key={ch} className="px-3 py-3 text-center">
                      <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-mono">
                        API required
                      </span>
                    </td>
                  ))}
                  {/* Sync status */}
                  <td className="px-4 py-3">
                    <span className="text-[10px] text-amber-600">Requires backend</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-[#E8D5C0] bg-[#FFF6EE]">
            <p className="text-xs text-[#92745E]">
              POS prices are live from <span className="font-mono">GET /products</span>.
              Channel-specific pricing columns (Website, QR, Swiggy, Zomato) require
              <span className="font-mono"> GET /products/:id/channels</span> per product.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
