interface QuantityStepperProps {
  quantity:    number;
  onIncrement: () => void;
  onDecrement: () => void;
  min?:        number;
  max?:        number;
  size?:       'sm' | 'md';
  disabled?:   boolean;
}

const sizeMap = {
  sm: { btn: 'w-6 h-6 text-sm', num: 'text-sm w-7 text-center font-bold' },
  md: { btn: 'w-8 h-8 text-base', num: 'text-sm w-9 text-center font-bold' },
};

export function QuantityStepper({
  quantity,
  onIncrement,
  onDecrement,
  min      = 0,
  max      = 99,
  size     = 'md',
  disabled = false,
}: QuantityStepperProps) {
  const s = sizeMap[size];

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onDecrement}
        disabled={disabled || quantity <= min}
        aria-label="Decrease quantity"
        className={`
          ${s.btn} rounded-full bg-[#FFF6EE] border border-[#E8D5C0]
          flex items-center justify-center text-[#1C0800] font-bold
          hover:bg-[#E8D5C0] disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors
        `}
      >
        −
      </button>
      <span className={s.num}>{quantity}</span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={disabled || quantity >= max}
        aria-label="Increase quantity"
        className={`
          ${s.btn} rounded-full bg-[#E8380D]
          flex items-center justify-center text-white font-bold
          hover:bg-[#C4300B] disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors
        `}
      >
        +
      </button>
    </div>
  );
}
