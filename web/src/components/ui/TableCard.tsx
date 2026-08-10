import { memo } from 'react';
import { Users, Clock, Loader2 } from 'lucide-react';
import type { TableGridItem } from '../../types';
import { StatusChip } from './StatusChip';
import { LiveBadge } from './LiveBadge';

interface TableCardProps {
  table:            TableGridItem;
  hasNewOrder:      boolean;
  currencySymbol:   string;
  onSelect?:        (sessionId: string) => void;
  onOpenAvailable?: () => void;
  isOpening?:       boolean;
}

function elapsedLabel(openedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(openedAt).getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function borderColor(status: TableGridItem['status'], hasNewOrder: boolean): string {
  if (hasNewOrder)           return 'border-brand/60 ring-1 ring-brand/20';
  if (status === 'occupied') return 'border-green-300';
  if (status === 'reserved') return 'border-amber-200';
  if (status === 'inactive') return 'border-dashed border-border';
  return 'border-border';
}

function bgColor(status: TableGridItem['status']): string {
  if (status === 'occupied') return 'bg-green-50';
  if (status === 'reserved') return 'bg-amber-50';
  if (status === 'inactive') return 'bg-mist';
  return 'bg-canvas';
}

export const TableCard = memo(function TableCard({
  table,
  hasNewOrder,
  currencySymbol,
  onSelect,
  onOpenAvailable,
  isOpening = false,
}: TableCardProps) {
  const { session, status } = table;
  const displayName = table.name || `T${table.number}`;
  const clickable = (!!onSelect && !!table.currentSessionId) || !!onOpenAvailable;

  function handleClick() {
    if (isOpening) return;
    if (onOpenAvailable && status === 'available') {
      onOpenAvailable();
    } else if (onSelect && table.currentSessionId) {
      onSelect(table.currentSessionId);
    }
  }

  return (
    <div
      onClick={clickable ? handleClick : undefined}
      className={`relative flex min-h-[108px] flex-col rounded-xl border p-3.5 transition-shadow hover:shadow-md ${borderColor(status, hasNewOrder)} ${bgColor(status)} ${clickable ? 'cursor-pointer active:scale-[0.98]' : ''}`}
    >
      {/* New order badge */}
      {hasNewOrder && (
        <div className="absolute -right-1.5 -top-1.5 z-10">
          <LiveBadge />
        </div>
      )}

      {/* Header — table name + status chip */}
      <div className="mb-2 flex items-start justify-between gap-1">
        <span className="text-lg font-bold text-ink leading-tight">{displayName}</span>
        <StatusChip
          status={status === 'available' ? 'available' : status === 'occupied' ? 'occupied' : status === 'reserved' ? 'reserved' : 'inactive'}
          size="xs"
        />
      </div>

      {/* Session data */}
      {status === 'occupied' && session ? (
        <div className="flex flex-col gap-1.5">
          {/* Amount — hero stat */}
          <span className="text-xl font-bold tabular-nums text-ink leading-none">
            {currencySymbol}{session.runningTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
          {/* Meta row — guests + timer */}
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1 text-green-700">
              <Users size={10} />
              {session.activeGuestCount}/{session.guestCount}
            </span>
            <span className="flex items-center gap-1 text-ink/50">
              <Clock size={10} />
              {elapsedLabel(session.openedAt)}
            </span>
          </div>
        </div>
      ) : status === 'reserved' ? (
        <p className="mt-auto text-xs text-amber-600">Reserved</p>
      ) : status === 'inactive' ? (
        <p className="mt-auto text-xs text-ink/45">Inactive</p>
      ) : isOpening ? (
        <p className="mt-auto flex items-center gap-1 text-xs text-brand">
          <Loader2 size={11} className="animate-spin" /> Opening…
        </p>
      ) : onOpenAvailable ? (
        <p className="mt-auto text-xs font-medium text-brand/90">Tap to seat guests</p>
      ) : (
        <p className="mt-auto text-xs text-ink/55">
          {table.capacity} seats
        </p>
      )}
    </div>
  );
});
