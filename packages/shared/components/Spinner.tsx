import type { HTMLAttributes } from 'react';

interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-9 w-9' };

export function Spinner({ size = 'md', className = '', ...rest }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-spin rounded-full border-2 border-[#E8D5C0] border-t-[#E8380D] ${sizeMap[size]} ${className}`}
      {...rest}
    />
  );
}
