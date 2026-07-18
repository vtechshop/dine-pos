import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner.tsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?:    'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?:    ReactNode;
}

const variantMap: Record<string, string> = {
  primary:   'bg-[#E8380D] text-white hover:bg-[#C4300B] disabled:opacity-60',
  secondary: 'bg-[#1C0800] text-white hover:bg-[#2C1800] disabled:opacity-60',
  ghost:     'bg-transparent text-[#E8380D] border border-[#E8380D] hover:bg-[#FFF6EE] disabled:opacity-60',
  danger:    'bg-red-600 text-white hover:bg-red-700 disabled:opacity-60',
};

const sizeMap: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-md gap-1.5',
  md: 'px-4 py-2   text-sm rounded-lg gap-2',
  lg: 'px-6 py-3   text-base rounded-xl gap-2.5',
};

export function Button({
  variant = 'primary',
  size    = 'md',
  loading = false,
  icon,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center font-semibold
        transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8380D]
        ${variantMap[variant]} ${sizeMap[size]} ${className}
      `}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
}
