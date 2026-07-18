import { Spinner } from './Spinner.tsx';

interface LoadingProps {
  message?: string;
  className?: string;
}

export function Loading({ message = 'Loading…', className = '' }: LoadingProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
      <Spinner size="lg" />
      <p className="text-sm text-[#7A5C48]">{message}</p>
    </div>
  );
}
