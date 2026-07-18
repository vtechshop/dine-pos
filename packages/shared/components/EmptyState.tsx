import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?:        ReactNode;
  title:        string;
  description?: string;
  action?:      ReactNode;
  className?:   string;
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 px-6 text-center ${className}`}>
      {icon && <div className="text-4xl text-[#E8D5C0]">{icon}</div>}
      <p className="text-base font-semibold text-[#1C0800]">{title}</p>
      {description && <p className="text-sm text-[#7A5C48] max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
