import { memo } from 'react';
import { Users, Clock } from 'lucide-react';
import type { TableGridItem } from '../../types';
import { StatusChip } from './StatusChip';
import { LiveBadge } from './LiveBadge';

interface TableCardProps {
  table:        TableGridItem;
  hasNewOrder:  boolean;
  currencySymbol: string;
}

function elapsedLabel(openedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(openedAt).getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function borderColor(status: TableGridItem['status'], hasNewOrder: boolean): string {
  if (hasNewOrder)          return 'border-blue-300 ring-1 ring-blue-200';
  if (status === 'occupied') return 'border-green-200';
  if (status === 'reserved') return 'border-amber-200';
  if (status === 'inactive') return 'border-dashed border-gray-200';
  return 'border-gray-100';
}

function bgColor(status: TableGridItem['status']): string {
  if (status === 'occupied') return 'bg-white';
  if (status === 'reserved') return 'bg-amber-50';
  if (status === 'inactive') return 'bg-gray-50';
  return 'bg-gray-50';
}

export const TableCard = memo(function TableCard({
  table,
  hasNewOrder,
  currencySymbol,
}: TableCardProps) {
  const { session, status } = table;
  const displayName = table.name || `T${table.number}`;

  return (
    <div
      className={`relative flex flex-col rounded-xl border p-3.5 transition-shadow hover:shadow-md ${borderColor(status, hasNewOrder)} ${bgColor(status)}`}
    >
      {/* New order badge */}
      {hasNewOrder && (
        <div className="absolute -right-1.5 -top-1.5 z-10">
          <LiveBadge />
        </div>
      )}

      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-1">
        <span className="text-base font-bold text-gray-900 leading-tight">{displayName}</span>
        <StatusChip
          status={status === 'available' ? 'available' : status === 'occupied' ? 'occupied' : status === 'reserved' ? 'reserved' : 'inactive'}
          size="xs"
        />
      </div>

      {/* Session data */}
      {status === 'occupied' && session ? (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-gray-400">
              <Users size={11} /> Guests
            </span>
            <span className="font-semibold text-gray-700">
              {session.activeGuestCount}/{session.guestCount}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Total</span>
            <span className="font-bold text-gray-900 tabular-nums">
              {currencySymbol}{session.runningTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-gray-400">
              <Clock size={11} /> Open
            </span>
            <span className="text-gray-500">{elapsedLabel(session.openedAt)}</span>
          </div>
        </div>
      ) : status === 'reserved' ? (
        <p className="mt-auto text-xs text-amber-600">Reserved</p>
      ) : status === 'inactive' ? (
        <p className="mt-auto text-xs text-gray-400">Inactive</p>
      ) : (
        <p className="mt-auto text-xs text-gray-400">
          {table.capacity} seats
        </p>
      )}
    </div>
  );
});
