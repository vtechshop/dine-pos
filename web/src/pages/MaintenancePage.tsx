import { Wrench } from 'lucide-react';

interface MaintenancePageProps {
  message:  string;
  onLogout: () => void;
  onRetry:  () => void;
}

export function MaintenancePage({ message, onLogout, onRetry }: MaintenancePageProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-mist p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-canvas p-8 text-center shadow-lg">
        <div className="mb-4 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
            <Wrench size={26} className="text-amber-600" />
          </div>
        </div>

        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-brand">Dine POS</p>
        <h1 className="mt-1 text-xl font-bold text-ink">System Maintenance</h1>

        <p className="mt-4 text-sm leading-relaxed text-ink/60">
          {message || 'We are currently performing scheduled maintenance. Please try again in a few minutes.'}
        </p>

        <button
          onClick={onRetry}
          className="mt-6 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand/90"
        >
          Check Again
        </button>

        <button
          onClick={onLogout}
          className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-ink/40 transition-colors hover:text-ink/70"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
