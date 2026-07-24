import { memo } from 'react';
import { Users, Clock, Loader2, ChevronRight } from 'lucide-react';
import type { TableGridItem } from '../../types';

interface TableCardProps {
  table:            TableGridItem;
  hasNewOrder:      boolean;
  currencySymbol:   string;
  onSelect?:        (sessionId: string) => void;
  onOpenAvailable?: () => void;
  isOpening?:       boolean;
}

function elapsedMins(openedAt: string): number {
  return Math.floor((Date.now() - new Date(openedAt).getTime()) / 60_000);
}

function elapsedLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Time-on-table bar — green→amber→red; critical >90m pulses
function TimeBar({ openedAt }: { openedAt: string }) {
  const mins = elapsedMins(openedAt);
  const pct  = Math.min((mins / 90) * 100, 100);
  const color = mins < 30  ? 'bg-green-400'
              : mins < 60  ? 'bg-amber-400'
              : 'bg-[#DC2626]';
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border/50">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color} ${mins >= 90 ? 'animate-pulse' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// Card border + bg based on state
function cardClass(status: TableGridItem['status'], hasNewOrder: boolean, clickable: boolean): string {
  const base = 'relative flex flex-col rounded-xl border p-3 transition-all duration-150 ';
  const interact = clickable ? 'cursor-pointer hover:shadow-2 active:scale-[.98] ' : '';
  if (hasNewOrder) return base + interact + 'border-brand/50 bg-brand-light ring-1 ring-brand/20 ';
  if (status === 'occupied') return base + interact + 'border-green-200 bg-canvas hover:border-green-300 ';
  if (status === 'reserved') return base + interact + 'border-amber-200 bg-amber-50/60 ';
  if (status === 'inactive') return base + 'border-dashed border-border/60 bg-ink/[.02] opacity-60 ';
  return base + interact + 'border-border bg-canvas hover:border-brand/30 ';
}

export const TableCard = memo(function TableCard({
  table, hasNewOrder, currencySymbol,
  onSelect, onOpenAvailable, isOpening = false,
}: TableCardProps) {
  const { session, status } = table;
  const displayName = table.name || `T${table.number}`;
  const clickable   = (!!onSelect && !!table.currentSessionId) || !!onOpenAvailable;
  const mins        = session?.openedAt ? elapsedMins(session.openedAt) : 0;

  function handleClick() {
    if (isOpening) return;
    if (onOpenAvailable && status === 'available') onOpenAvailable();
    else if (onSelect && table.currentSessionId) onSelect(table.currentSessionId);
  }

  return (
    <div onClick={clickable ? handleClick : undefined} className={cardClass(status, hasNewOrder, clickable)}>

      {/* New order pulse badge */}
      {hasNewOrder && (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 z-10">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-brand" />
        </span>
      )}

      {/* Header row: name + status chip */}
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <span className="text-sm font-bold leading-tight text-ink">{displayName}</span>
        {status === 'occupied' && (
          <span className="shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">OCC</span>
        )}
        {status === 'available' && (
          <span className="shrink-0 rounded-full bg-ink/6 px-1.5 py-0.5 text-[10px] font-semibold text-ink/40">FREE</span>
        )}
        {status === 'reserved' && (
          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">RES</span>
        )}
        {status === 'inactive' && (
          <span className="shrink-0 rounded-full bg-border/60 px-1.5 py-0.5 text-[10px] font-semibold text-ink/30">OFF</span>
        )}
      </div>

      {/* Occupied: session data */}
      {status === 'occupied' && session ? (
        <>
          <div className="flex items-center justify-between text-xs mt-0.5">
            <span className="flex items-center gap-0.5 text-ink/40">
              <Users size={10} />{session.activeGuestCount}/{session.guestCount}
            </span>
            <span className="font-bold tabular-nums text-ink">
              {currencySymbol}{session.runningTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="flex items-center gap-0.5 mt-1 text-[11px]">
            <Clock size={10} className={mins >= 60 ? 'text-[#DC2626]' : mins >= 30 ? 'text-amber-500' : 'text-green-500'} />
            <span className={mins >= 60 ? 'text-[#DC2626] font-semibold' : 'text-ink/40'}>
              {elapsedLabel(mins)}
            </span>
          </div>
          <TimeBar openedAt={session.openedAt} />
        </>
      ) : status === 'reserved' ? (
        <p className="mt-1 text-[11px] text-amber-600 font-medium">Reserved</p>
      ) : status === 'inactive' ? (
        <p className="mt-1 text-[11px] text-ink/30">Inactive</p>
      ) : isOpening ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-brand">
          <Loader2 size={10} className="animate-spin" /> Opening…
        </p>
      ) : onOpenAvailable ? (
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[11px] text-ink/40">{table.capacity} seats</span>
          <span className="text-[11px] text-brand flex items-center gap-0.5 font-medium">
            Open <ChevronRight size={10} />
          </span>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-ink/40">{table.capacity} seats</p>
      )}
    </div>
  );
});
