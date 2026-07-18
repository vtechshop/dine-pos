import type { ReactNode } from 'react';
import { Button } from './Button.tsx';

interface ErrorStateProps {
  title?:     string;
  message:    string;
  onRetry?:   () => void;
  action?:    ReactNode;
  className?: string;
}

export function ErrorState({
  title   = 'Something went wrong',
  message,
  onRetry,
  action,
  className = '',
}: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 px-6 text-center ${className}`}>
      <div className="text-4xl">⚠️</div>
      <p className="text-base font-semibold text-[#1C0800]">{title}</p>
      <p className="text-sm text-[#7A5C48] max-w-xs">{message}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      )}
      {action}
    </div>
  );
}
