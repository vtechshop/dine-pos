import type { SplitDetails } from '../../api/billing';

interface Props {
  total: number;
  value: SplitDetails;
  onChange: (v: SplitDetails) => void;
  currencySymbol: string;
  disabled?: boolean;
}

export function SplitInput({ total, value, onChange, currencySymbol, disabled }: Props) {
  const sum = value.cash + value.card + value.upi;
  const remaining = total - sum;
  const valid = Math.abs(remaining) < 0.01;

  function update(field: keyof SplitDetails, raw: string) {
    const n = parseFloat(raw) || 0;
    onChange({ ...value, [field]: n });
  }

  return (
    <div className="space-y-2">
      {(['cash', 'card', 'upi'] as (keyof SplitDetails)[]).map(field => (
        <div key={field} className="flex items-center gap-2">
          <label className="w-12 text-xs font-medium capitalize text-gray-500">{field}</label>
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              {currencySymbol}
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              disabled={disabled}
              value={value[field] || ''}
              onChange={e => update(field, e.target.value)}
              placeholder="0"
              className="w-full rounded-md border border-gray-200 pl-6 pr-2 py-1.5 text-sm text-right outline-none focus:border-[#E8380D]/50 focus:ring-1 focus:ring-[#E8380D]/20 disabled:opacity-50"
            />
          </div>
        </div>
      ))}

      <div className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium ${
        valid ? 'bg-green-50 text-green-700' : remaining < 0 ? 'bg-red-50 text-red-600' : 'bg-yellow-50 text-yellow-700'
      }`}>
        <span>{valid ? 'Total matches' : remaining > 0 ? `Remaining: ${currencySymbol}${remaining.toFixed(2)}` : `Over by: ${currencySymbol}${Math.abs(remaining).toFixed(2)}`}</span>
        <span className="font-mono">
          {currencySymbol}{sum.toFixed(2)} / {currencySymbol}{total.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
