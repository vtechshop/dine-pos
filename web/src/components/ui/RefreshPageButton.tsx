import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Reloads the current page's data (the layout re-mounts the page) without a
 * full browser reload — login, live connection and the cashier cart stay as they are.
 */
export function RefreshPageButton({ onRefresh, className = '' }: { onRefresh: () => void; className?: string }) {
  const [spinning, setSpinning] = useState(false);

  function handleClick() {
    onRefresh();
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 700);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Refresh page"
      title="Refresh page"
      className={`rounded-lg p-1.5 text-ink/50 transition-colors hover:bg-mist hover:text-ink ${className}`}
    >
      <RefreshCw size={15} className={spinning ? 'animate-spin' : ''} />
    </button>
  );
}
