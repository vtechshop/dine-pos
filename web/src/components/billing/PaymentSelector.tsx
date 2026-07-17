import type { PaymentMethod } from '../../types';

interface Props {
  value: PaymentMethod;
  onChange: (m: PaymentMethod) => void;
  disabled?: boolean;
}

const METHODS: { key: PaymentMethod; label: string; shortcut: string }[] = [
  { key: 'cash',          label: 'Cash',    shortcut: 'C' },
  { key: 'card',          label: 'Card',    shortcut: 'K' },
  { key: 'upi',           label: 'UPI',     shortcut: 'U' },
  { key: 'split',         label: 'Split',   shortcut: 'S' },
  { key: 'complimentary', label: 'Comp',    shortcut: 'M' },
];

export function PaymentSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {METHODS.map(m => (
        <button
          key={m.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(m.key)}
          className={`flex-1 min-w-[60px] rounded-lg border px-3 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
            value === m.key
              ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
              : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
          }`}
        >
          <span>{m.label}</span>
          <span className={`ml-1 text-[10px] font-mono ${value === m.key ? 'text-blue-200' : 'text-gray-400'}`}>
            {m.shortcut}
          </span>
        </button>
      ))}
    </div>
  );
}
