import { useState, useRef, useCallback, useId } from 'react';
import { useSettings } from '../context/SettingsContext';
import {
  Upload, FileText, Image, X, CheckCircle2, AlertCircle,
  ChevronDown, ChevronRight, Plus, Trash2, Edit3, Check,
  Sparkles, Loader2, Package, Tag, RefreshCw, ArrowRight,
  ChevronUp, Settings2,
} from 'lucide-react';
import {
  extractMenu, checkDuplicates, importMenu,
  ExtractedProduct, ExtractedCategory,
  ImportProduct, ImportCategory, ImportVariant,
  ImportModifierOption, ImportModifierGroup,
  ImportResults,
} from '../api/aiMenu';

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = 'idle' | 'uploading' | 'extracting' | 'checking' | 'review' | 'importing' | 'done' | 'error';
type DuplicateAction = 'skip' | 'overwrite' | 'copy';

interface EditableVariant {
  _id:   string;
  name:  string;
  price: number;
}

interface EditableModifierOption {
  _id:   string;
  name:  string;
  price: number;
}

interface EditableModifierGroup {
  _id:           string;
  name:          string;
  required:      boolean;
  selectionType: 'single' | 'multi';
  options:       EditableModifierOption[];
}

interface EditableProduct extends ExtractedProduct {
  _id:             string;
  isDuplicate:     boolean;
  existingCategory?: string;
  duplicateAction: DuplicateAction;
  isDeleted:       boolean;
  isEditing:       boolean;
  variants:        EditableVariant[];
  modifierGroups:  EditableModifierGroup[];
}

interface EditableCategory {
  _id:       string;
  name:      string;
  isDeleted: boolean;
  collapsed: boolean;
  products:  EditableProduct[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let _uid = 0;
function uid(): string { return `ai-${++_uid}`; }

function buildEditable(cats: ExtractedCategory[]): EditableCategory[] {
  return cats.map(c => ({
    _id:       uid(),
    name:      c.name,
    isDeleted: false,
    collapsed: false,
    products:  c.products.map(p => ({
      ...p,
      _id:             uid(),
      isDuplicate:     false,
      duplicateAction: 'skip' as DuplicateAction,
      isDeleted:       false,
      isEditing:       false,
      variants: (p.variants ?? []).map(v => ({
        _id:   uid(),
        name:  v.name,
        price: v.price,
      })),
      modifierGroups: (p.modifierGroups ?? []).map(mg => ({
        _id:           uid(),
        name:          mg.name,
        required:      mg.required,
        selectionType: mg.selectionType,
        options: (mg.options ?? []).map(opt => ({
          _id:   uid(),
          name:  opt.name,
          price: opt.price,
        })),
      })),
    })),
  }));
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'uploading',  label: 'Uploading'   },
  { key: 'extracting', label: 'AI Reading'  },
  { key: 'checking',   label: 'Checking DB' },
  { key: 'review',     label: 'Review'      },
];

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg';
const MAX_MB         = 20;

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const activeIdx = STEPS.findIndex(s => s.key === current);
  return (
    <div className="flex items-center gap-0 justify-center mb-6">
      {STEPS.map((step, i) => {
        const done   = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={step.key} className="flex items-center">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              done   ? 'bg-green-500 text-white' :
              active ? 'bg-brand text-white ring-4 ring-brand/20' :
                       'bg-border text-ink/30'
            }`}>
              {done ? <Check size={14} /> : i + 1}
            </div>
            <span className={`ml-1.5 text-xs font-medium hidden sm:inline ${
              active ? 'text-brand' : done ? 'text-green-600' : 'text-ink/30'
            }`}>{step.label}</span>
            {i < STEPS.length - 1 && (
              <div className={`mx-2 h-px w-8 sm:w-12 ${done ? 'bg-green-400' : 'bg-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConfidencePip({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1.5 min-w-[56px]">
      <div className="h-1.5 w-10 rounded-full bg-border overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-ink/40">{pct}%</span>
    </div>
  );
}

// ── Upload Zone ────────────────────────────────────────────────────────────────

function UploadZone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError]       = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function validate(file: File): string | null {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['pdf', 'png', 'jpg', 'jpeg'].includes(ext)) {
      return 'Only PDF, PNG, JPG files are supported';
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      return `File must be under ${MAX_MB} MB`;
    }
    return null;
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    const err  = validate(file);
    if (err) { setError(err); return; }
    setError('');
    onFile(file);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10">
            <Sparkles size={32} className="text-brand" />
          </div>
          <h1 className="text-2xl font-bold text-ink">AI Menu Import</h1>
          <p className="mt-1 text-sm text-ink/50">
            Upload your menu — Gemini reads it and extracts every category and product.
          </p>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`group relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-14 cursor-pointer transition-all ${
            dragging
              ? 'border-brand bg-brand/5 scale-[1.01]'
              : 'border-border bg-canvas hover:border-brand/50 hover:bg-brand/[0.03]'
          }`}
        >
          <Upload size={36} className={`transition-colors ${dragging ? 'text-brand' : 'text-ink/25 group-hover:text-brand/50'}`} />
          <div className="text-center">
            <p className="font-semibold text-ink">Drop your menu here</p>
            <p className="text-sm text-ink/40">or click to browse</p>
          </div>
          <div className="flex gap-2">
            {['PDF', 'PNG', 'JPG'].map(t => (
              <span key={t} className="rounded-full border border-border bg-white px-2.5 py-0.5 text-xs font-semibold text-ink/50">
                {t}
              </span>
            ))}
          </div>
          <p className="text-xs text-ink/30">Max {MAX_MB} MB</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="sr-only"
            onChange={e => handleFiles(e.target.files)}
          />
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            <AlertCircle size={15} className="shrink-0" /> {error}
          </div>
        )}

        <div className="mt-6 rounded-xl border border-border bg-canvas p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">How it works</p>
          <div className="space-y-2">
            {[
              { icon: Upload,       text: 'Upload your menu as PDF, PNG, or JPG' },
              { icon: Sparkles,     text: 'Gemini reads and extracts categories, products, variants & modifiers' },
              { icon: Edit3,        text: 'Review, edit, and fix any extracted data' },
              { icon: CheckCircle2, text: 'Confirm to create categories and products in POS' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 text-sm text-ink/60">
                <Icon size={14} className="shrink-0 text-brand" />
                {text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Processing screen ──────────────────────────────────────────────────────────

function ProcessingScreen({ step, filename }: { step: Step; filename: string }) {
  const msgs: Partial<Record<Step, string>> = {
    uploading:  'Uploading your menu...',
    extracting: 'Gemini is reading the menu. This may take 20–60 seconds for PDFs...',
    checking:   'Checking for existing products...',
  };
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <StepIndicator current={step} />
      <Loader2 size={40} className="animate-spin text-brand" />
      <p className="font-semibold text-ink">{msgs[step]}</p>
      <p className="text-sm text-ink/40 truncate max-w-xs">{filename}</p>
    </div>
  );
}

// ── Variants Editor ────────────────────────────────────────────────────────────

function VariantsEditor({
  variants,
  onChange,
}: {
  variants: EditableVariant[];
  onChange: (v: EditableVariant[]) => void;
}) {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  function add() {
    onChange([...variants, { _id: uid(), name: '', price: 0 }]);
  }
  function remove(id: string) {
    onChange(variants.filter(v => v._id !== id));
  }
  function update(id: string, patch: Partial<EditableVariant>) {
    onChange(variants.map(v => v._id === id ? { ...v, ...patch } : v));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
          Variants <span className="font-normal normal-case">(Half / Full / Small / Large…)</span>
        </p>
        <button
          onClick={add}
          className="flex items-center gap-1 rounded-md border border-border bg-white px-2 py-0.5 text-[11px] font-semibold text-ink/50 hover:border-brand/50 hover:text-brand transition-colors"
        >
          <Plus size={11} /> Add
        </button>
      </div>
      {variants.length === 0 ? (
        <p className="text-[11px] text-ink/30 italic">No variants — base price used at checkout.</p>
      ) : (
        <div className="space-y-1">
          {variants.map(v => (
            <div key={v._id} className="flex items-center gap-2">
              <input
                value={v.name}
                onChange={e => update(v._id, { name: e.target.value })}
                placeholder="Name (e.g. Half)"
                className="flex-1 rounded-md border border-border bg-white px-2 py-1 text-xs outline-none focus:border-brand"
              />
              <div className="flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1">
                <span className="text-[10px] text-ink/40">{sym}</span>
                <input
                  type="number"
                  min={0}
                  value={v.price}
                  onChange={e => update(v._id, { price: Math.max(0, Number(e.target.value)) })}
                  className="w-16 text-xs outline-none tabular-nums"
                />
              </div>
              <button
                onClick={() => remove(v._id)}
                className="rounded-md p-1 text-ink/30 hover:bg-red-50 hover:text-red-500 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modifier Groups Editor ─────────────────────────────────────────────────────

function ModifierGroupsEditor({
  groups,
  onChange,
}: {
  groups: EditableModifierGroup[];
  onChange: (g: EditableModifierGroup[]) => void;
}) {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  function addGroup() {
    onChange([...groups, {
      _id: uid(), name: '', required: false,
      selectionType: 'multi', options: [],
    }]);
  }
  function removeGroup(id: string) {
    onChange(groups.filter(g => g._id !== id));
  }
  function updateGroup(id: string, patch: Partial<EditableModifierGroup>) {
    onChange(groups.map(g => g._id === id ? { ...g, ...patch } : g));
  }
  function addOption(gid: string) {
    onChange(groups.map(g =>
      g._id !== gid ? g : {
        ...g,
        options: [...g.options, { _id: uid(), name: '', price: 0 }],
      },
    ));
  }
  function removeOption(gid: string, oid: string) {
    onChange(groups.map(g =>
      g._id !== gid ? g : {
        ...g,
        options: g.options.filter(o => o._id !== oid),
      },
    ));
  }
  function updateOption(gid: string, oid: string, patch: Partial<EditableModifierOption>) {
    onChange(groups.map(g =>
      g._id !== gid ? g : {
        ...g,
        options: g.options.map(o => o._id === oid ? { ...o, ...patch } : o),
      },
    ));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
          Modifier Groups <span className="font-normal normal-case">(Add-ons, Spice Level…)</span>
        </p>
        <button
          onClick={addGroup}
          className="flex items-center gap-1 rounded-md border border-border bg-white px-2 py-0.5 text-[11px] font-semibold text-ink/50 hover:border-brand/50 hover:text-brand transition-colors"
        >
          <Plus size={11} /> Add Group
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="text-[11px] text-ink/30 italic">No modifier groups — no add-ons at checkout.</p>
      ) : (
        <div className="space-y-2">
          {groups.map(g => (
            <div key={g._id} className="rounded-lg border border-border bg-white p-2.5">
              {/* Group header */}
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={g.name}
                  onChange={e => updateGroup(g._id, { name: e.target.value })}
                  placeholder="Group name (e.g. Add-ons)"
                  className="flex-1 rounded-md border border-border bg-canvas px-2 py-1 text-xs font-semibold outline-none focus:border-brand"
                />
                <select
                  value={g.selectionType}
                  onChange={e => updateGroup(g._id, { selectionType: e.target.value as 'single' | 'multi' })}
                  className="rounded-md border border-border bg-canvas px-1.5 py-1 text-[10px] outline-none"
                >
                  <option value="single">Single select</option>
                  <option value="multi">Multi select</option>
                </select>
                <label className="flex items-center gap-1 text-[10px] text-ink/50">
                  <input
                    type="checkbox"
                    checked={g.required}
                    onChange={e => updateGroup(g._id, { required: e.target.checked })}
                    className="rounded"
                  />
                  Required
                </label>
                <button
                  onClick={() => removeGroup(g._id)}
                  className="rounded p-1 text-ink/30 hover:bg-red-50 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {/* Options */}
              <div className="space-y-1 pl-2 border-l-2 border-border">
                {g.options.map(opt => (
                  <div key={opt._id} className="flex items-center gap-2">
                    <input
                      value={opt.name}
                      onChange={e => updateOption(g._id, opt._id, { name: e.target.value })}
                      placeholder="Option name"
                      className="flex-1 rounded border border-border bg-white px-2 py-0.5 text-[11px] outline-none focus:border-brand"
                    />
                    <div className="flex items-center gap-0.5 rounded border border-border bg-white px-1.5 py-0.5">
                      <span className="text-[9px] text-ink/40">{sym}</span>
                      <input
                        type="number"
                        min={0}
                        value={opt.price}
                        onChange={e => updateOption(g._id, opt._id, { price: Math.max(0, Number(e.target.value)) })}
                        className="w-12 text-[11px] outline-none tabular-nums"
                      />
                    </div>
                    <button
                      onClick={() => removeOption(g._id, opt._id)}
                      className="rounded p-0.5 text-ink/20 hover:text-red-500 transition-colors"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addOption(g._id)}
                  className="flex items-center gap-1 text-[10px] text-brand/60 hover:text-brand transition-colors mt-0.5"
                >
                  <Plus size={10} /> Add option
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Review Panel ───────────────────────────────────────────────────────────────

interface ReviewPanelProps {
  categories:    EditableCategory[];
  filePreview:   string | null;
  fileName:      string;
  fileType:      string;
  onUpdate:      (cats: EditableCategory[]) => void;
  onImport:      () => void;
  importing:     boolean;
}

function ReviewPanel({
  categories, filePreview, fileName, fileType,
  onUpdate, onImport, importing,
}: ReviewPanelProps) {
  const [search, setSearch]       = useState('');
  const [vegFilter, setVegFilter] = useState<'all' | 'veg' | 'nonveg'>('all');
  const labelId = useId();

  const totalProducts = categories.reduce(
    (s, c) => s + c.products.filter(p => !p.isDeleted).length, 0,
  );
  const duplicates = categories.reduce(
    (s, c) => s + c.products.filter(p => !p.isDeleted && p.isDuplicate).length, 0,
  );

  function setCategory(id: string, patch: Partial<EditableCategory>) {
    onUpdate(categories.map(c => c._id === id ? { ...c, ...patch } : c));
  }
  function setProduct(catId: string, prodId: string, patch: Partial<EditableProduct>) {
    onUpdate(categories.map(c =>
      c._id !== catId ? c : {
        ...c,
        products: c.products.map(p => p._id === prodId ? { ...p, ...patch } : p),
      },
    ));
  }
  function addProduct(catId: string) {
    const blank: EditableProduct = {
      _id: uid(), name: '', price: null, variants: [], modifierGroups: [],
      veg: true, gst: null, hsnCode: '', shortCode: '', description: '', confidence: 1,
      isDuplicate: false, duplicateAction: 'skip', isDeleted: false, isEditing: true,
    };
    onUpdate(categories.map(c =>
      c._id !== catId ? c : { ...c, products: [...c.products, blank] },
    ));
  }
  function addCategory() {
    onUpdate([...categories, {
      _id: uid(), name: 'New Category',
      isDeleted: false, collapsed: false, products: [],
    }]);
  }
  function moveProduct(catId: string, prodId: string, toCatId: string) {
    let prod: EditableProduct | undefined;
    const updated = categories.map(c => {
      if (c._id === catId) {
        const idx = c.products.findIndex(p => p._id === prodId);
        if (idx >= 0) prod = c.products[idx];
        return { ...c, products: c.products.filter(p => p._id !== prodId) };
      }
      return c;
    });
    if (!prod) return;
    onUpdate(updated.map(c =>
      c._id === toCatId ? { ...c, products: [...c.products, prod!] } : c,
    ));
  }

  const visibleCats = categories
    .filter(c => !c.isDeleted)
    .map(c => ({
      ...c,
      products: c.products.filter(p => {
        if (p.isDeleted) return false;
        if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
        if (vegFilter === 'veg' && !p.veg) return false;
        if (vegFilter === 'nonveg' && p.veg) return false;
        return true;
      }),
    }))
    .filter(c => !search || c.products.length > 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 border-b border-border bg-canvas px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-ink">Review Extracted Menu</h1>
            <p className="text-xs text-ink/40">
              {totalProducts} products · {categories.filter(c => !c.isDeleted).length} categories
              {duplicates > 0 && <span className="ml-1.5 text-amber-600">· {duplicates} duplicates found</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={addCategory}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-mist transition-colors"
            >
              <Plus size={13} /> Add Category
            </button>
            <button
              onClick={onImport}
              disabled={importing || totalProducts === 0}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50 transition-colors"
            >
              {importing
                ? <><Loader2 size={14} className="animate-spin" /> Importing...</>
                : <><ArrowRight size={14} /> Import {totalProducts} Products</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File preview */}
        {filePreview && (
          <div className="hidden lg:flex w-[380px] shrink-0 flex-col border-r border-border bg-white">
            <div className="border-b border-border px-4 py-2.5">
              <p className="flex items-center gap-2 text-xs font-semibold text-ink/50">
                {fileType === 'application/pdf'
                  ? <FileText size={13} className="text-red-400" />
                  : <Image size={13} className="text-blue-400" />}
                {fileName}
              </p>
            </div>
            <div className="flex-1 overflow-auto">
              {fileType === 'application/pdf' ? (
                <iframe src={filePreview} className="h-full w-full" title="Menu PDF preview" />
              ) : (
                <img src={filePreview} alt="Menu preview" className="w-full object-contain" />
              )}
            </div>
          </div>
        )}

        {/* Review table */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border bg-white px-4 py-2 flex items-center gap-2">
            <input
              id={labelId}
              type="search"
              placeholder="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-border bg-canvas px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10"
            />
            {(['all', 'veg', 'nonveg'] as const).map(f => (
              <button
                key={f}
                onClick={() => setVegFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  vegFilter === f
                    ? 'bg-brand text-white'
                    : 'border border-border bg-white text-ink/50 hover:bg-mist'
                }`}
              >
                {f === 'all' ? 'All' : f === 'veg' ? '🟢 Veg' : '🔴 Non-veg'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {visibleCats.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-ink/30">
                <Package size={32} className="mb-2" />
                <p className="text-sm">No products match your filter</p>
              </div>
            )}
            {visibleCats.map(cat => (
              <CategorySection
                key={cat._id}
                cat={cat}
                allCategories={categories.filter(c => !c.isDeleted)}
                onToggle={() => setCategory(cat._id, { collapsed: !cat.collapsed })}
                onRename={name => setCategory(cat._id, { name })}
                onDelete={() => setCategory(cat._id, { isDeleted: true })}
                onAddProduct={() => addProduct(cat._id)}
                onUpdateProduct={(pid, patch) => setProduct(cat._id, pid, patch)}
                onMoveProduct={(pid, toCat) => moveProduct(cat._id, pid, toCat)}
              />
            ))}
            <button
              onClick={addCategory}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3 text-sm text-ink/30 hover:border-brand/40 hover:text-brand/60 transition-colors"
            >
              <Plus size={15} /> Add Category
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Category Section ───────────────────────────────────────────────────────────

interface CategorySectionProps {
  cat:             EditableCategory;
  allCategories:   EditableCategory[];
  onToggle:        () => void;
  onRename:        (name: string) => void;
  onDelete:        () => void;
  onAddProduct:    () => void;
  onUpdateProduct: (id: string, patch: Partial<EditableProduct>) => void;
  onMoveProduct:   (prodId: string, toCatId: string) => void;
}

function CategorySection({
  cat, allCategories, onToggle, onRename, onDelete,
  onAddProduct, onUpdateProduct, onMoveProduct,
}: CategorySectionProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal]         = useState(cat.name);

  function commitName() {
    setEditingName(false);
    onRename(nameVal.trim() || cat.name);
  }

  const visibleProducts = cat.products.filter(p => !p.isDeleted);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-mist px-4 py-2.5">
        <button onClick={onToggle} className="shrink-0 text-ink/40 hover:text-ink transition-colors">
          {cat.collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        {editingName ? (
          <input
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }}
            autoFocus
            className="flex-1 rounded border border-brand/50 bg-white px-2 py-0.5 text-sm font-semibold text-ink outline-none"
          />
        ) : (
          <span
            className="flex-1 text-sm font-bold uppercase tracking-wide text-ink/70 cursor-pointer hover:text-brand transition-colors"
            onDoubleClick={() => { setEditingName(true); setNameVal(cat.name); }}
          >
            <Tag size={11} className="mr-1.5 inline text-brand" />
            {cat.name}
          </span>
        )}
        <span className="rounded-full bg-border px-2 py-0.5 text-[10px] font-semibold text-ink/50">
          {visibleProducts.length}
        </span>
        <button onClick={onAddProduct} title="Add product" className="rounded-lg p-1 text-ink/30 hover:bg-brand/10 hover:text-brand transition-colors">
          <Plus size={14} />
        </button>
        <button onClick={() => setEditingName(true)} title="Rename" className="rounded-lg p-1 text-ink/30 hover:bg-brand/10 hover:text-brand transition-colors">
          <Edit3 size={13} />
        </button>
        <button onClick={onDelete} title="Delete category" className="rounded-lg p-1 text-ink/30 hover:bg-red-50 hover:text-red-500 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>

      {!cat.collapsed && visibleProducts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-ink/30">
                <th className="px-4 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-center">Type</th>
                <th className="px-3 py-2 text-left hidden md:table-cell">Details</th>
                <th className="px-3 py-2 text-left hidden lg:table-cell">Confidence</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleProducts.map(prod => (
                <ProductRow
                  key={prod._id}
                  prod={prod}
                  allCategories={allCategories}
                  currentCatId={cat._id}
                  onUpdate={patch => onUpdateProduct(prod._id, patch)}
                  onDelete={() => onUpdateProduct(prod._id, { isDeleted: true })}
                  onMove={toCatId => onMoveProduct(prod._id, toCatId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!cat.collapsed && visibleProducts.length === 0 && (
        <div className="flex items-center justify-center py-6 text-xs text-ink/30">
          No products — <button onClick={onAddProduct} className="ml-1 text-brand hover:underline">add one</button>
        </div>
      )}
    </div>
  );
}

// ── Product Row ────────────────────────────────────────────────────────────────

interface ProductRowProps {
  prod:          EditableProduct;
  allCategories: EditableCategory[];
  currentCatId:  string;
  onUpdate:      (patch: Partial<EditableProduct>) => void;
  onDelete:      () => void;
  onMove:        (toCatId: string) => void;
}

function ProductRow({ prod, allCategories, currentCatId, onUpdate, onDelete, onMove }: ProductRowProps) {
  const { settings } = useSettings();
  const sym = settings?.currencySymbol ?? '₹';
  const [editing, setEditing]   = useState(prod.isEditing);
  const [name, setName]         = useState(prod.name);
  const [price, setPrice]       = useState(String(prod.price ?? ''));
  const [showMove, setShowMove] = useState(false);
  const [expanded, setExpanded] = useState(false);

  function commit() {
    onUpdate({ name: name.trim() || prod.name, price: price === '' ? null : Number(price), isEditing: false });
    setEditing(false);
  }

  const hasVariants   = prod.variants.length > 0;
  const hasModifiers  = prod.modifierGroups.length > 0;
  const hasDetails    = hasVariants || hasModifiers;

  if (editing) {
    return (
      <tr className="bg-brand/[0.03]">
        <td className="px-4 py-2">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            className="w-full rounded border border-brand/50 bg-white px-2 py-1 text-sm outline-none"
            placeholder="Product name"
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={price}
            onChange={e => setPrice(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); }}
            type="number"
            min={0}
            className="w-24 rounded border border-brand/50 bg-white px-2 py-1 text-right text-sm outline-none"
            placeholder="0"
          />
        </td>
        <td className="px-3 py-2 text-center">
          <button onClick={() => onUpdate({ veg: !prod.veg })} className="text-lg leading-none">
            {prod.veg ? '🟢' : '🔴'}
          </button>
        </td>
        <td className="px-3 py-2 hidden md:table-cell" />
        <td className="hidden lg:table-cell" />
        <td className="px-3 py-2 text-right">
          <button onClick={commit} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand/90">
            <Check size={12} />
          </button>
        </td>
      </tr>
    );
  }

  // Display price: lowest variant price or base price
  const displayPrice = hasVariants
    ? Math.min(...prod.variants.map(v => v.price))
    : prod.price;

  return (
    <>
      <tr className={`group transition-colors ${prod.isDuplicate ? 'bg-amber-50' : 'hover:bg-mist'}`}>
        {/* Product name + duplicate info */}
        <td className="px-4 py-2.5 max-w-[200px]">
          <div className="flex items-start gap-2">
            <div>
              <span className="font-medium text-ink">{prod.name || <em className="text-ink/30">Unnamed</em>}</span>
              {prod.description && (
                <p className="text-[11px] text-ink/40 mt-0.5 line-clamp-1">{prod.description}</p>
              )}
            </div>
            {prod.isDuplicate && (
              <span className="ml-1 shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                Exists
              </span>
            )}
          </div>
          {prod.isDuplicate && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {prod.existingCategory && prod.existingCategory !== prod.name && (
                <span className="text-[10px] text-amber-600">
                  in &quot;{prod.existingCategory}&quot; ·
                </span>
              )}
              <span className="text-[10px] text-amber-600">Action:</span>
              {(['skip', 'overwrite', 'copy'] as DuplicateAction[]).map(a => (
                <button
                  key={a}
                  onClick={() => onUpdate({ duplicateAction: a })}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize transition-colors ${
                    prod.duplicateAction === a
                      ? 'bg-brand text-white'
                      : 'bg-white border border-border text-ink/50 hover:border-brand/50'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </td>

        {/* Price */}
        <td className="px-3 py-2.5 text-right tabular-nums">
          {displayPrice !== null
            ? <span className="font-semibold text-ink">{sym}{displayPrice}{hasVariants && <span className="text-[10px] text-ink/30">+</span>}</span>
            : <span className="text-xs text-ink/30">—</span>
          }
        </td>

        {/* Veg/Non-veg */}
        <td className="px-3 py-2.5 text-center text-base">
          {prod.veg ? '🟢' : '🔴'}
        </td>

        {/* Details badges */}
        <td className="px-3 py-2.5 hidden md:table-cell">
          <div className="flex flex-wrap gap-1">
            {hasVariants && (
              <span className="rounded-full bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">
                {prod.variants.length} size{prod.variants.length > 1 ? 's' : ''}
              </span>
            )}
            {hasModifiers && (
              <span className="rounded-full bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[9px] font-semibold text-purple-700">
                {prod.modifierGroups.length} mod{prod.modifierGroups.length > 1 ? 's' : ''}
              </span>
            )}
            {prod.hsnCode && (
              <span className="rounded-full bg-slate-50 border border-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                HSN
              </span>
            )}
            {!hasDetails && !prod.hsnCode && (
              <span className="text-ink/20 text-xs">—</span>
            )}
          </div>
        </td>

        {/* Confidence */}
        <td className="px-3 py-2.5 hidden lg:table-cell">
          <ConfidencePip value={prod.confidence} />
        </td>

        {/* Actions */}
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Expand variants/modifiers */}
            <button
              onClick={() => setExpanded(v => !v)}
              title={expanded ? 'Collapse details' : 'Edit variants & modifiers'}
              className={`rounded-lg p-1.5 transition-colors ${
                expanded
                  ? 'bg-brand/10 text-brand'
                  : 'text-ink/30 hover:bg-brand/10 hover:text-brand'
              }`}
            >
              {expanded ? <ChevronUp size={13} /> : <Settings2 size={13} />}
            </button>

            {/* Move to category */}
            <div className="relative">
              <button
                onClick={() => setShowMove(v => !v)}
                title="Move to category"
                className="rounded-lg p-1.5 text-ink/30 hover:bg-brand/10 hover:text-brand transition-colors"
              >
                <RefreshCw size={13} />
              </button>
              {showMove && (
                <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-border bg-white shadow-xl">
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink/30">Move to</p>
                  {allCategories.filter(c => c._id !== currentCatId).map(c => (
                    <button
                      key={c._id}
                      onClick={() => { onMove(c._id); setShowMove(false); }}
                      className="flex w-full items-center px-3 py-2 text-sm text-ink hover:bg-mist transition-colors"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button onClick={() => setEditing(true)} title="Edit" className="rounded-lg p-1.5 text-ink/30 hover:bg-brand/10 hover:text-brand transition-colors">
              <Edit3 size={13} />
            </button>
            <button onClick={onDelete} title="Delete" className="rounded-lg p-1.5 text-ink/30 hover:bg-red-50 hover:text-red-500 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>

      {/* Expandable detail row for variants and modifier groups */}
      {expanded && (
        <tr className="bg-slate-50/60">
          <td colSpan={6} className="px-6 py-3">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <VariantsEditor
                variants={prod.variants}
                onChange={variants => onUpdate({ variants })}
              />
              <ModifierGroupsEditor
                groups={prod.modifierGroups}
                onChange={modifierGroups => onUpdate({ modifierGroups })}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Import Results ─────────────────────────────────────────────────────────────

function ImportResultsPanel({
  results,
  onReset,
}: {
  results: ImportResults;
  onReset: () => void;
}) {
  const totalOk = results.productsCreated + results.productsOverwritten;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4">
      <div className={`flex h-20 w-20 items-center justify-center rounded-full ${
        results.errors.length === 0 ? 'bg-green-50' : 'bg-amber-50'
      }`}>
        {results.errors.length === 0
          ? <CheckCircle2 size={40} className="text-green-500" />
          : <AlertCircle size={40} className="text-amber-500" />
        }
      </div>

      <div className="text-center">
        <h2 className="text-xl font-bold text-ink">Import Complete</h2>
        <p className="mt-1 text-sm text-ink/50">
          {totalOk} product{totalOk !== 1 ? 's' : ''} imported successfully
        </p>
      </div>

      <div className="grid w-full max-w-sm grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: 'Categories',   value: results.categoriesCreated,    color: 'text-brand' },
          { label: 'Products',     value: results.productsCreated,      color: 'text-green-600' },
          { label: 'Overwritten',  value: results.productsOverwritten,  color: 'text-blue-600' },
          { label: 'Skipped',      value: results.productsSkipped,      color: 'text-ink/40' },
          { label: 'Mod. Groups',  value: results.modifierGroupsCreated, color: 'text-purple-600' },
          { label: 'Errors',       value: results.errors.length,        color: results.errors.length > 0 ? 'text-red-500' : 'text-ink/30' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-border bg-white p-4 text-center">
            <p className={`text-2xl font-black ${color}`}>{value}</p>
            <p className="text-xs text-ink/40">{label}</p>
          </div>
        ))}
      </div>

      {results.errors.length > 0 && (
        <div className="w-full max-w-sm rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="mb-2 text-xs font-semibold text-red-700">{results.errors.length} error{results.errors.length !== 1 ? 's' : ''}</p>
          <ul className="space-y-1">
            {results.errors.map((e, i) => (
              <li key={i} className="text-xs text-red-600">• {e.name}: {e.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <a
          href="/products"
          className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 transition-colors"
        >
          View Products
        </a>
        <button
          onClick={onReset}
          className="rounded-xl border border-border bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-mist transition-colors"
        >
          Import Another Menu
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function AIMenuImportPage() {
  const [step, setStep]                   = useState<Step>('idle');
  const [file, setFile]                   = useState<File | null>(null);
  const [filePreview, setFilePreview]     = useState<string | null>(null);
  const [categories, setCategories]       = useState<EditableCategory[]>([]);
  const [importResults, setImportResults] = useState<ImportResults | null>(null);
  const [error, setError]                 = useState('');

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError('');
    setFilePreview(URL.createObjectURL(f));

    try {
      setStep('uploading');
      await new Promise(r => setTimeout(r, 300));
      setStep('extracting');
      const result = await extractMenu(f);

      setStep('checking');
      let dupeMap = new Map<string, string>();
      try {
        const { duplicates } = await checkDuplicates(result.categories);
        for (const d of duplicates) {
          dupeMap.set(d.productName.toLowerCase(), d.existingCategoryName);
        }
      } catch {
        // Non-fatal — proceed without duplicate marking
      }

      const editable = buildEditable(result.categories).map(cat => ({
        ...cat,
        products: cat.products.map(p => {
          const existingCat = dupeMap.get(p.name.toLowerCase());
          return {
            ...p,
            isDuplicate:     existingCat !== undefined,
            existingCategory: existingCat,
          };
        }),
      }));

      setCategories(editable);
      setStep('review');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep('error');
    }
  }, []);

  const handleImport = useCallback(async () => {
    setStep('importing');
    try {
      const payload: ImportCategory[] = categories
        .filter(c => !c.isDeleted)
        .map(c => ({
          name: c.name,
          products: c.products
            .filter(p => !p.isDeleted)
            .map(p => ({
              name:    p.name,
              price:   p.price,
              variants: p.variants.map(v => ({
                name:  v.name,
                price: v.price,
              } as ImportVariant)),
              modifierGroups: p.modifierGroups
                .filter(mg => mg.name.trim() && mg.options.length > 0)
                .map(mg => ({
                  name:          mg.name,
                  required:      mg.required,
                  selectionType: mg.selectionType,
                  options: mg.options
                    .filter(opt => opt.name.trim())
                    .map(opt => ({
                      name:  opt.name,
                      price: opt.price,
                    } as ImportModifierOption)),
                } as ImportModifierGroup)),
              veg:             p.veg,
              gst:             p.gst,
              hsnCode:         p.hsnCode  || '',
              shortCode:       p.shortCode || '',
              description:     p.description,
              confidence:      p.confidence,
              duplicateAction: p.isDuplicate ? p.duplicateAction : undefined,
            } as ImportProduct)),
        }));

      const res = await importMenu(payload);
      setImportResults(res.results);
      setStep('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep('error');
    }
  }, [categories]);

  function reset() {
    setStep('idle');
    setFile(null);
    setFilePreview(null);
    setCategories([]);
    setImportResults(null);
    setError('');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-mist">
      {step === 'error' && (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
            <div className="flex gap-2">
              {file && (
                <button
                  onClick={() => handleFile(file)}
                  className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                >
                  <RefreshCw size={12} /> Retry
                </button>
              )}
              <button
                onClick={reset}
                className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                Start Over
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`flex-1 ${step === 'review' || step === 'importing' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {step === 'idle' && <UploadZone onFile={handleFile} />}

        {(step === 'uploading' || step === 'extracting' || step === 'checking') && (
          <ProcessingScreen step={step} filename={file?.name ?? ''} />
        )}

        {(step === 'review' || step === 'importing') && (
          <ReviewPanel
            categories={categories}
            filePreview={filePreview}
            fileName={file?.name ?? ''}
            fileType={file?.type ?? ''}
            onUpdate={setCategories}
            onImport={handleImport}
            importing={step === 'importing'}
          />
        )}

        {step === 'done' && importResults && (
          <ImportResultsPanel results={importResults} onReset={reset} />
        )}

        {step === 'error' && <UploadZone onFile={handleFile} />}
      </div>
    </div>
  );
}
