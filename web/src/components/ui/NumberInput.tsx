import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (n: number) => void;
};

const toText = (n: number) => (n === 0 ? '' : String(n));

/**
 * Number field that keeps what's typed as text while editing.
 *
 * `value={n} onChange={e => set(parseFloat(e.target.value) || 0)}` snaps an
 * emptied field back to 0, so the 0 can't be deleted and typing "10" gives
 * "010". Here the field can be empty (shown as the placeholder, default "0"),
 * and leading zeros are tidied on blur.
 */
export function NumberInput({ value, onValueChange, onBlur, placeholder = '0', ...rest }: Props) {
  const [text, setText] = useState(toText(value));

  // Follow outside changes (form reset, editing another record) without
  // clobbering an in-progress edit that already parses to the same number.
  useEffect(() => {
    setText(prev => (parseFloat(prev || '0') === value ? prev : toText(value)));
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onChange={e => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        onValueChange(Number.isFinite(n) ? n : 0);
      }}
      onBlur={e => {
        const n = parseFloat(text);
        setText(Number.isFinite(n) ? toText(n) : '');
        onBlur?.(e);
      }}
    />
  );
}
