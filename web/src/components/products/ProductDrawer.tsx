import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, Trash2, Loader2, ImageIcon, Wand2, ChevronDown, RefreshCw, CheckCircle2, AlertTriangle, FlaskConical } from 'lucide-react';
import type { Product, Category, ModifierGroup } from '../../types';
import type { ProductInput, RecipeItemInput } from '../../api/products';
import { createProduct, updateProduct, updateProductRecipe, generateProductImage } from '../../api/products';
import { apiFetch } from '../../api/client';
import {
  fetchModifierGroups,
  assignModifierGroupToProduct,
  removeModifierGroupFromProduct,
} from '../../api/modifiers';
import { fetchKitchenStations } from '../../api/kitchenStations';
import type { KitchenStation } from '../../api/kitchenStations';
import { useShortcut } from '../../hooks/useShortcut';
import { useSettings } from '../../context/SettingsContext';

// Ingredient type from the backend
interface Ingredient {
  _id: string;
  name: string;
  unit: string;
  currentStock: number;
  costPerUnit: number;
}

interface Props {
  product: Product | null;
  categories: Category[];
  onSave: (p: Product) => void;
  onClose: () => void;
}

const BLANK: ProductInput = {
  name: '',
  price: 0,
  category: '',
  taxPercent: 5,
  hsnCode: '',
  isAvailable: true,
  isVeg: true,
  shortCode: '',
  description: '',
  stock: -1,
  kitchenStation: null,
};

const AI_STYLES = [
  { key: 'menu',   label: 'Menu Photo' },
  { key: 'rustic', label: 'Rustic'     },
  { key: 'fine',   label: 'Fine Dining' },
];

type VariantDraft = { _id?: string; name: string; price: number };
type RecipeDraft  = { ingredient: Ingredient; quantity: number };

export function ProductDrawer({ product, categories, onSave, onClose }: Props) {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  const [form, setForm]         = useState<ProductInput>(BLANK);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // ── Image ─────────────────────────────────────────────────────────────────────
  const [imageUrl,       setImageUrl]       = useState('');
  // Tracks where the current imageUrl came from so imageSource is saved correctly
  const [imageSourceType, setImageSourceType] = useState<'existing' | 'gallery' | 'ai'>('existing');
  const [imgUploading,   setImgUploading]   = useState(false);
  const [imgError,       setImgError]       = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── AI Image Generation panel ─────────────────────────────────────────────────
  const [showAiPanel,   setShowAiPanel]   = useState(false);
  const [aiPrompt,      setAiPrompt]      = useState('');
  const [aiStyle,       setAiStyle]       = useState('menu');
  const [aiGenerating,  setAiGenerating]  = useState(false);
  // Stores base64 data URL for preview — not uploaded until user confirms
  const [aiPreviewData, setAiPreviewData] = useState<string | null>(null);
  const [aiError,       setAiError]       = useState<string | null>(null);

  // ── Kitchen Station ───────────────────────────────────────────────────────────
  const [stations,        setStations]        = useState<KitchenStation[]>([]);
  const [stationsLoading, setStationsLoading] = useState(false);

  // ── Recipe (edit mode only) ───────────────────────────────────────────────────
  const [recipe,           setRecipe]           = useState<RecipeDraft[]>([]);
  const [ingredientSearch, setIngSearch]        = useState('');
  const [allIngredients,   setAllIngredients]   = useState<Ingredient[]>([]);
  const [ingLoading,       setIngLoading]       = useState(false);
  const [ingFeatureOff,    setIngFeatureOff]    = useState(false);
  const [recipeSaving,     setRecipeSaving]     = useState(false);
  const [recipeError,      setRecipeError]      = useState<string | null>(null);
  const [recipeSaved,      setRecipeSaved]      = useState(false);

  // ── Modifier Groups (edit mode only) ─────────────────────────────────────────
  const [assignedGroups, setAssignedGroups] = useState<ModifierGroup[]>([]);
  const [allGroups,      setAllGroups]      = useState<ModifierGroup[]>([]);
  const [mgLoading,      setMgLoading]      = useState(false);
  const [mgSearch,       setMgSearch]       = useState('');
  const [mgAssigning,    setMgAssigning]    = useState(false);
  const [mgRemoving,     setMgRemoving]     = useState<string | null>(null);
  const [mgError,        setMgError]        = useState<string | null>(null);

  // ── Load stations once ────────────────────────────────────────────────────────
  useEffect(() => {
    setStationsLoading(true);
    fetchKitchenStations()
      .then(setStations)
      .catch(() => {})
      .finally(() => setStationsLoading(false));
  }, []);

  useEffect(() => {
    if (product) {
      const catId = product.category
        ? (typeof product.category === 'object' ? product.category._id : String(product.category))
        : '';
      const stationId = product.kitchenStation
        ? (typeof product.kitchenStation === 'object' ? product.kitchenStation._id : String(product.kitchenStation))
        : null;
      setForm({
        name:           product.name,
        price:          product.price,
        category:       catId,
        taxPercent:     product.taxPercent,
        hsnCode:        product.hsnCode,
        isAvailable:    product.isAvailable,
        isVeg:          product.isVeg,
        shortCode:      product.shortCode,
        description:    product.description,
        stock:          product.stock,
        kitchenStation: stationId,
      });
      setImageUrl(product.image ?? '');
      setImageSourceType('existing');
      setVariants((product.variants ?? []).map(v => ({ _id: v._id, name: v.name, price: v.price })));
      setAssignedGroups(((product.modifierGroups ?? []) as (ModifierGroup | null)[]).filter((g): g is ModifierGroup => g !== null));

      // Load recipe ingredients — backend now populates recipe.ingredient, so typeof check
      // accepts both populated objects (normal) and fallback string refs (edge case).
      if (product.recipe && product.recipe.length > 0) {
        const drafts: RecipeDraft[] = product.recipe
          .filter(r => r.ingredient != null)
          .map(r => {
            const ing = r.ingredient as { _id: string; name: string; unit: string; costPerUnit: number };
            return {
              ingredient: {
                _id:         typeof ing === 'object' ? ing._id   : String(ing),
                name:        typeof ing === 'object' ? ing.name  : '',
                unit:        typeof ing === 'object' ? ing.unit  : '',
                costPerUnit: typeof ing === 'object' ? (ing.costPerUnit ?? 0) : 0,
                currentStock: 0,
              },
              quantity: r.quantity,
            };
          })
          .filter(d => d.ingredient._id);
        setRecipe(drafts);
      } else {
        setRecipe([]);
      }

      // Load modifier groups
      setMgLoading(true);
      fetchModifierGroups({ active: true, limit: 200 })
        .then(res => setAllGroups(res.groups))
        .catch(() => setMgError('Failed to load modifier groups'))
        .finally(() => setMgLoading(false));

      // Load ingredients (may be 403 if feature disabled)
      setIngLoading(true);
      apiFetch<{ ingredients: Ingredient[] }>('/ingredients?limit=200')
        .then(res => { setAllIngredients(res.ingredients); setIngFeatureOff(false); })
        .catch(err => {
          if ((err as { status?: number }).status === 403) setIngFeatureOff(true);
        })
        .finally(() => setIngLoading(false));
    } else {
      setForm(BLANK);
      setImageUrl('');
      setImageSourceType('existing');
      setVariants([]);
      setRecipe([]);
      setAssignedGroups([]);
      setAllGroups([]);
      setAllIngredients([]);
    }
    setImgError(null);
    setAiError(null);
    setAiPreviewData(null);
    setShowAiPanel(false);
    setMgError(null);
    setRecipeError(null);
    setRecipeSaved(false);
  }, [product]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgError(null);
    setImgUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const { url } = await apiFetch<{ url: string }>('/uploads/image', { method: 'POST', body: fd });
      setImageUrl(url);
      setImageSourceType('gallery');
      setAiPreviewData(null);
    } catch (err) {
      setImgError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setImgUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleGenerateImage() {
    if (!product) return;
    setAiError(null);
    setAiGenerating(true);
    setAiPreviewData(null);
    try {
      const { imageData } = await generateProductImage(product._id, {
        prompt: aiPrompt.trim() || undefined,
        style: aiStyle,
      });
      setAiPreviewData(imageData);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setAiGenerating(false);
    }
  }

  // Upload the base64 preview to Cloudinary only when user explicitly confirms.
  // This prevents orphaned uploads from abandoned generations.
  async function handleUseAiImage() {
    if (!aiPreviewData) return;
    setImgUploading(true);
    setImgError(null);
    try {
      // Convert base64 data URL → Blob → FormData and reuse the existing upload endpoint
      const res = await fetch(aiPreviewData);
      const blob = await res.blob();
      const fd = new FormData();
      fd.append('image', blob, 'ai-generated.jpg');
      const { url } = await apiFetch<{ url: string }>('/uploads/image', { method: 'POST', body: fd });
      setImageUrl(url);
      setImageSourceType('ai');
      setAiPreviewData(null);
      setShowAiPanel(false);
    } catch (err) {
      setImgError(err instanceof Error ? err.message : 'Failed to save AI image');
    } finally {
      setImgUploading(false);
    }
  }

  async function handleAssignGroup(groupId: string) {
    if (!product) return;
    setMgAssigning(true);
    setMgError(null);
    try {
      await assignModifierGroupToProduct(product._id, groupId);
      const group = allGroups.find(g => g._id === groupId);
      if (group) setAssignedGroups(prev => [...prev, group]);
      setMgSearch('');
    } catch {
      setMgError('Failed to assign modifier group');
    } finally {
      setMgAssigning(false);
    }
  }

  async function handleRemoveGroup(mgId: string) {
    if (!product) return;
    setMgRemoving(mgId);
    setMgError(null);
    try {
      await removeModifierGroupFromProduct(product._id, mgId);
      setAssignedGroups(prev => prev.filter(g => g._id !== mgId));
    } catch {
      setMgError('Failed to remove modifier group');
    } finally {
      setMgRemoving(null);
    }
  }

  async function handleSaveRecipe() {
    if (!product) return;
    setRecipeSaving(true);
    setRecipeError(null);
    setRecipeSaved(false);
    try {
      const items: RecipeItemInput[] = recipe.map(r => ({
        ingredient: r.ingredient._id,
        quantity: r.quantity,
      }));
      await updateProductRecipe(product._id, items);
      setRecipeSaved(true);
      setTimeout(() => setRecipeSaved(false), 3000);
    } catch (err) {
      setRecipeError(err instanceof Error ? err.message : 'Failed to save recipe');
    } finally {
      setRecipeSaving(false);
    }
  }

  const filteredIngredients = ingredientSearch
    ? allIngredients.filter(
        i => i.name.toLowerCase().includes(ingredientSearch.toLowerCase()) &&
          !recipe.some(r => r.ingredient._id === i._id),
      )
    : allIngredients.filter(i => !recipe.some(r => r.ingredient._id === i._id)).slice(0, 20);

  const availableGroups   = allGroups.filter(g => !assignedGroups.some(a => a._id === g._id));
  const filteredAvailable = mgSearch
    ? availableGroups.filter(g => g.name.toLowerCase().includes(mgSearch.toLowerCase()))
    : availableGroups;

  const recipeCost = recipe.reduce((sum, r) => sum + r.ingredient.costPerUnit * r.quantity, 0);

  useShortcut('Escape', onClose);

  function set<K extends keyof ProductInput>(key: K, val: ProductInput[K]) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.category || form.price <= 0) {
      setError('Name, category and a price > 0 are required');
      return;
    }
    for (const v of variants) {
      if (!v.name.trim()) { setError('Variant names cannot be empty'); return; }
      if (v.price < 0)    { setError('Variant prices must be ≥ 0'); return; }
    }
    setSaving(true);
    setError(null);
    try {
      // imageSourceType tracks where the current imageUrl came from:
      //   'existing' → no change from what was already saved
      //   'gallery'  → user uploaded a file
      //   'ai'       → user confirmed an AI-generated image
      const resolvedImageSource: string | undefined =
        !imageUrl                          ? undefined :
        imageSourceType === 'ai'           ? 'ai' :
        imageSourceType === 'gallery'      ? 'gallery' :
        (product?.imageSource ?? undefined);

      const resolvedImageStatus: string | undefined =
        !imageUrl                          ? undefined :
        imageSourceType === 'ai'           ? 'real' :
        imageSourceType === 'gallery'      ? 'real' :
        ((product as any)?.imageStatus ?? undefined);

      const payload: ProductInput = {
        ...form,
        variants,
        image:       imageUrl || undefined,
        imageSource: resolvedImageSource,
        imageStatus: resolvedImageStatus,
      };
      const saved = product
        ? await updateProduct(product._id, payload)
        : await createProduct(payload);
      onSave(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  useShortcut('Enter', () => { void handleSave(); }, !saving);

  const field =
    'block w-full rounded-lg border border-border px-3 py-2 text-sm text-ink outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20';
  const sectionLabel =
    'mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/50';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-canvas shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-ink px-5 py-3 text-white">
          <h2 className="text-sm font-semibold">{product ? 'Edit Product' : 'New Product'}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/40 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {/* ── Image ──────────────────────────────────────────────────────── */}
          <div>
            <label className={sectionLabel}>Product Image</label>

            {imageUrl ? (
              <div className="relative overflow-hidden rounded-lg border border-border">
                <img src={imageUrl} alt="Product" className="h-40 w-full object-cover" onError={() => setImageUrl('')} />
                <div className="absolute right-2 top-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={imgUploading}
                    onClick={() => fileRef.current?.click()}
                    className="rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-black/70 disabled:opacity-40"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImageUrl(''); setAiPreviewData(null); }}
                    className="rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={imgUploading}
                onClick={() => fileRef.current?.click()}
                className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-mist transition-colors hover:border-brand/40 hover:bg-brand/5 disabled:cursor-default disabled:opacity-60"
              >
                {imgUploading
                  ? <><Loader2 size={20} className="animate-spin text-brand" /><span className="text-xs text-ink/50">Uploading…</span></>
                  : <><ImageIcon size={20} className="text-ink/30" /><span className="text-xs text-ink/50">Click to upload image</span><span className="text-[10px] text-ink/30">JPG, PNG, WEBP · max 5 MB</span></>
                }
              </button>
            )}

            {imgError && <p className="mt-1 text-xs text-red-500">{imgError}</p>}

            {/* AI Image Generation — only for existing products */}
            {product && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => { setShowAiPanel(p => !p); setAiError(null); setAiPreviewData(null); }}
                  className="flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
                >
                  <Wand2 size={12} />
                  Generate with AI
                  <ChevronDown size={10} className={`transition-transform ${showAiPanel ? 'rotate-180' : ''}`} />
                </button>

                {showAiPanel && (
                  <div className="mt-2 space-y-2 rounded-xl border border-brand/20 bg-brand/5 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">AI Image Generation</p>

                    {/* Style selector */}
                    <div className="flex gap-1.5">
                      {AI_STYLES.map(s => (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() => setAiStyle(s.key)}
                          className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                            aiStyle === s.key
                              ? 'border-brand bg-brand text-white'
                              : 'border-border bg-canvas text-ink/50 hover:bg-mist'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>

                    {/* Custom prompt */}
                    <textarea
                      className={`${field} h-16 resize-none text-xs`}
                      placeholder={`Describe the image, or leave blank to auto-generate for "${product.name}"`}
                      value={aiPrompt}
                      onChange={e => setAiPrompt(e.target.value)}
                    />

                    {aiError && (
                      <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
                        <p className="text-xs text-red-600">{aiError}</p>
                      </div>
                    )}

                    {/* Generated preview */}
                    {aiPreviewData && (
                      <div className="space-y-2">
                        <img src={aiPreviewData} alt="AI generated" className="w-full rounded-lg object-cover" style={{ maxHeight: 180 }} />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleUseAiImage()}
                            disabled={imgUploading}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand py-2 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
                          >
                            {imgUploading
                              ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                              : <><CheckCircle2 size={13} /> Use This Image</>
                            }
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleGenerateImage()}
                            disabled={aiGenerating || imgUploading}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-semibold text-ink/60 hover:bg-mist disabled:opacity-40"
                          >
                            <RefreshCw size={13} /> Regenerate
                          </button>
                        </div>
                      </div>
                    )}

                    {!aiPreviewData && (
                      <button
                        type="button"
                        onClick={() => void handleGenerateImage()}
                        disabled={aiGenerating}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-ink py-2 text-xs font-semibold text-white hover:bg-ink/90 disabled:opacity-50"
                      >
                        {aiGenerating
                          ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
                          : <><Wand2 size={13} /> Generate Image</>
                        }
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={e => { void handleImageFile(e); }}
            />
          </div>

          {/* ── Name ───────────────────────────────────────────────────────── */}
          <div>
            <label className={sectionLabel}>Name *</label>
            <input className={field} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Product name" autoFocus />
          </div>

          {/* ── Category ───────────────────────────────────────────────────── */}
          <div>
            <label className={sectionLabel}>Category *</label>
            <select className={field} value={form.category} onChange={e => set('category', e.target.value)}>
              <option value="">Select category…</option>
              {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>

          {/* ── Price + Tax ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={sectionLabel}>Price ({sym}) *</label>
              <input className={field} type="number" min={0} step={0.01} value={form.price} onChange={e => set('price', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className={sectionLabel}>Tax %</label>
              <input className={field} type="number" min={0} max={100} step={0.5} value={form.taxPercent} onChange={e => set('taxPercent', parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          {/* ── Veg + Available ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={sectionLabel}>Type</label>
              <div className="flex overflow-hidden rounded-lg border border-border">
                <button type="button" onClick={() => set('isVeg', true)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${form.isVeg ? 'bg-green-600 text-white' : 'bg-canvas text-ink/50 hover:bg-mist'}`}>
                  ● Veg
                </button>
                <button type="button" onClick={() => set('isVeg', false)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${!form.isVeg ? 'bg-red-600 text-white' : 'bg-canvas text-ink/50 hover:bg-mist'}`}>
                  ● Non-veg
                </button>
              </div>
            </div>
            <div>
              <label className={sectionLabel}>Available</label>
              <button type="button" onClick={() => set('isAvailable', !form.isAvailable)}
                className={`w-full rounded-lg border py-2 text-xs font-semibold transition-colors ${form.isAvailable ? 'border-green-200 bg-green-50 text-green-700' : 'border-border bg-mist text-ink/40'}`}>
                {form.isAvailable ? '✓ Available' : '✗ Unavailable'}
              </button>
            </div>
          </div>

          {/* ── Short Code + HSN ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={sectionLabel}>Short Code</label>
              <input className={field} value={form.shortCode} onChange={e => set('shortCode', e.target.value)} placeholder="e.g. CB" maxLength={8} />
            </div>
            <div>
              <label className={sectionLabel}>HSN Code</label>
              <input className={field} value={form.hsnCode} onChange={e => set('hsnCode', e.target.value)} placeholder="HSN" />
            </div>
          </div>

          {/* ── Kitchen Station ──────────────────────────────────────────────── */}
          <div>
            <label className={sectionLabel}>Kitchen Station</label>
            {stationsLoading ? (
              <div className="flex items-center gap-2 text-xs text-ink/40"><Loader2 size={12} className="animate-spin" /> Loading…</div>
            ) : stations.length === 0 ? (
              <p className="text-xs text-ink/40">No stations configured. Add them in Settings → Kitchen Stations.</p>
            ) : (
              <select className={field} value={form.kitchenStation ?? ''} onChange={e => set('kitchenStation', e.target.value || null)}>
                <option value="">Not assigned</option>
                {stations.filter(s => s.isActive).map(s => (
                  <option key={s._id} value={s._id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* ── Stock ───────────────────────────────────────────────────────── */}
          <div>
            <label className={sectionLabel}>Stock</label>
            <div className="mb-2 flex gap-2">
              <button type="button" onClick={() => set('stock', -1)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${(form.stock ?? -1) === -1 ? 'border-brand bg-brand/5 text-brand' : 'border-border bg-canvas text-ink/50 hover:bg-mist'}`}>
                Not tracked
              </button>
              <button type="button" onClick={() => set('stock', (form.stock ?? -1) < 0 ? 0 : (form.stock ?? 0))}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${(form.stock ?? -1) >= 0 ? 'border-brand bg-brand/5 text-brand' : 'border-border bg-canvas text-ink/50 hover:bg-mist'}`}>
                Track stock
              </button>
            </div>
            {(form.stock ?? -1) >= 0 && (
              <input className={field} type="number" min={0} value={form.stock ?? 0} onChange={e => set('stock', parseInt(e.target.value, 10) || 0)} placeholder="Current quantity" />
            )}
          </div>

          {/* ── Description ─────────────────────────────────────────────────── */}
          <div>
            <label className={sectionLabel}>Description</label>
            <textarea className={`${field} h-20 resize-none`} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional description" maxLength={500} />
          </div>

          {/* ── Variants ────────────────────────────────────────────────────── */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                Variants
                <span className="ml-1 font-normal normal-case tracking-normal text-ink/30">(e.g. Small, Medium, Large)</span>
              </label>
              <button type="button" onClick={() => setVariants(prev => [...prev, { name: '', price: 0 }])}
                className="flex items-center gap-1 rounded-md border border-brand/30 bg-brand/5 px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10">
                <Plus size={12} /> Add
              </button>
            </div>
            {variants.length === 0 && <p className="text-xs italic text-ink/30">No variants — product has a single price above.</p>}
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={v._id ?? `new-${i}`} className="flex items-center gap-2">
                  <input className={`${field} flex-1`} placeholder="Name (e.g. Large)" value={v.name}
                    onChange={e => setVariants(prev => prev.map((item, idx) => idx === i ? { ...item, name: e.target.value } : item))} />
                  <input className={`${field} w-24`} type="number" min={0} step={0.01} placeholder="Price" value={v.price}
                    onChange={e => setVariants(prev => prev.map((item, idx) => idx === i ? { ...item, price: parseFloat(e.target.value) || 0 } : item))} />
                  <button type="button" onClick={() => setVariants(prev => prev.filter((_, idx) => idx !== i))}
                    className="rounded-lg border border-red-100 p-2 text-red-400 hover:bg-red-50">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Recipe (edit mode only) ──────────────────────────────────────── */}
          {product && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <FlaskConical size={13} className="text-ink/40" />
                <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Recipe / Ingredients
                </label>
              </div>

              {ingFeatureOff ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                  Inventory module is not enabled for this account. Contact support to enable recipe management.
                </div>
              ) : ingLoading ? (
                <div className="flex items-center gap-2 text-xs text-ink/40"><Loader2 size={12} className="animate-spin" /> Loading ingredients…</div>
              ) : (
                <>
                  {/* Current recipe rows */}
                  {recipe.length > 0 && (
                    <div className="mb-3 overflow-hidden rounded-lg border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border bg-mist">
                            <th className="px-3 py-2 text-left font-semibold text-ink/50">Ingredient</th>
                            <th className="px-3 py-2 text-center font-semibold text-ink/50">Qty</th>
                            <th className="px-3 py-2 text-left font-semibold text-ink/50">Unit</th>
                            <th className="px-3 py-2 text-right font-semibold text-ink/50">Cost</th>
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {recipe.map((row, i) => (
                            <tr key={row.ingredient._id} className="border-b border-border last:border-0">
                              <td className="px-3 py-2 font-medium text-ink">{row.ingredient.name}</td>
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  value={row.quantity}
                                  onChange={e => setRecipe(prev =>
                                    prev.map((r, idx) => idx === i ? { ...r, quantity: parseFloat(e.target.value) || 0 } : r)
                                  )}
                                  className="w-16 rounded border border-border bg-canvas px-2 py-1 text-center text-xs outline-none focus:border-brand/50"
                                />
                              </td>
                              <td className="px-3 py-2 text-ink/50">{row.ingredient.unit}</td>
                              <td className="px-3 py-2 text-right font-mono text-ink/60">
                                {row.ingredient.costPerUnit > 0
                                  ? `${sym}${(row.ingredient.costPerUnit * row.quantity).toFixed(2)}`
                                  : '—'}
                              </td>
                              <td className="px-2 py-2">
                                <button type="button" onClick={() => setRecipe(prev => prev.filter((_, idx) => idx !== i))}
                                  className="rounded p-1 text-ink/30 hover:bg-red-50 hover:text-red-400">
                                  <X size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Recipe cost total */}
                  {recipe.length > 0 && recipeCost > 0 && (
                    <div className="mb-3 flex items-center justify-between rounded-lg bg-mist px-3 py-2">
                      <span className="text-xs text-ink/50">Recipe cost</span>
                      <span className="text-xs font-bold tabular-nums text-ink">{sym}{recipeCost.toFixed(2)}</span>
                    </div>
                  )}

                  {/* Add ingredient search */}
                  <div className="relative mb-1">
                    <input
                      type="text"
                      value={ingredientSearch}
                      onChange={e => setIngSearch(e.target.value)}
                      placeholder="Search ingredients to add…"
                      className={`${field} pr-8 text-xs`}
                    />
                    {ingredientSearch && (
                      <button type="button" onClick={() => setIngSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/30 hover:text-ink/60">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  {(ingredientSearch || filteredIngredients.length > 0) && (
                    <div className="mb-3 max-h-36 overflow-y-auto rounded-lg border border-border bg-canvas shadow-sm">
                      {filteredIngredients.length === 0 && ingredientSearch && (
                        <p className="px-3 py-2 text-xs text-ink/40">No matching ingredients.</p>
                      )}
                      {filteredIngredients.map(ing => (
                        <button key={ing._id} type="button"
                          onClick={() => { setRecipe(prev => [...prev, { ingredient: ing, quantity: 1 }]); setIngSearch(''); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-mist">
                          <Plus size={11} className="shrink-0 text-brand" />
                          <span className="font-medium text-ink">{ing.name}</span>
                          <span className="text-ink/40">· {ing.unit}</span>
                          {ing.costPerUnit > 0 && <span className="ml-auto text-ink/40">{sym}{ing.costPerUnit}/{ing.unit}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {recipeError && <p className="mb-2 text-xs text-red-500">{recipeError}</p>}

                  <button type="button" onClick={() => void handleSaveRecipe()} disabled={recipeSaving}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition-colors ${
                      recipeSaved
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-border bg-mist text-ink/60 hover:bg-ink/5'
                    } disabled:opacity-40`}>
                    {recipeSaving
                      ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                      : recipeSaved
                        ? <><CheckCircle2 size={12} /> Recipe Saved</>
                        : 'Save Recipe'
                    }
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Modifier Groups (edit mode only) ────────────────────────────── */}
          {product && (
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink/50">
                Modifier Groups
                <span className="ml-1 font-normal normal-case tracking-normal text-ink/30">(add-ons, extras)</span>
              </label>
              {mgError && <p className="mb-2 text-xs text-red-500">{mgError}</p>}
              {assignedGroups.length === 0
                ? <p className="mb-2 text-xs italic text-ink/30">No modifier groups assigned.</p>
                : (
                  <div className="mb-3 space-y-1.5">
                    {assignedGroups.map(g => (
                      <div key={g._id} className="flex items-center justify-between rounded-lg border border-border bg-mist px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-ink">{g.name}</p>
                          <p className="text-[10px] text-ink/40">{g.isRequired ? 'Required' : 'Optional'} · {g.selectionType} · {g.options.length} options</p>
                        </div>
                        <button type="button" disabled={mgRemoving === g._id} onClick={() => { void handleRemoveGroup(g._id); }}
                          className="ml-2 shrink-0 rounded-md border border-red-100 p-1.5 text-red-400 hover:bg-red-50 disabled:opacity-40">
                          {mgRemoving === g._id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    ))}
                  </div>
                )
              }
              {mgLoading
                ? <div className="flex items-center gap-2 text-xs text-ink/40"><Loader2 size={12} className="animate-spin" /> Loading groups…</div>
                : availableGroups.length > 0
                  ? <input type="text" value={mgSearch} onChange={e => setMgSearch(e.target.value)} placeholder="Search modifier groups to assign…" className={`${field} text-xs`} />
                  : assignedGroups.length === 0
                    ? <p className="text-xs text-ink/30">No modifier groups. Create one in the Modifiers page.</p>
                    : null
              }
              {mgSearch && filteredAvailable.length > 0 && (
                <div className="mt-1.5 max-h-36 overflow-y-auto rounded-lg border border-border bg-canvas shadow-sm">
                  {filteredAvailable.map(g => (
                    <button key={g._id} type="button" disabled={mgAssigning} onClick={() => { void handleAssignGroup(g._id); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-mist disabled:opacity-50">
                      {mgAssigning ? <Loader2 size={11} className="animate-spin shrink-0" /> : <Plus size={11} className="shrink-0 text-brand" />}
                      <span className="font-medium text-ink">{g.name}</span>
                      <span className="text-ink/40">· {g.options.length} options</span>
                    </button>
                  ))}
                </div>
              )}
              {mgSearch && filteredAvailable.length === 0 && <p className="mt-1 text-xs text-ink/35">No matching groups.</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-2 border-t border-border bg-mist px-5 py-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-border bg-canvas px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-mist">
            Cancel
          </button>
          <button onClick={() => { void handleSave(); }} disabled={saving || imgUploading}
            className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-40">
            {saving ? 'Saving…' : product ? 'Update' : 'Create Product'}
          </button>
        </div>
      </div>
    </div>
  );
}
