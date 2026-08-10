type Status =
  | 'occupied'
  | 'available'
  | 'reserved'
  | 'inactive'
  | 'online'
  | 'offline'
  | 'pending';

interface StatusChipProps {
  status: Status;
  label?: string;
  size?: 'xs' | 'sm';
}

const MAP: Record<Status, { bg: string; text: string; dot: string; label: string }> = {
  occupied:  { bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500',  label: 'Occupied'  },
  available: { bg: 'bg-green-50',   text: 'text-green-700',  dot: 'bg-green-500',  label: 'Available' },
  reserved:  { bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500',  label: 'Reserved'  },
  inactive:  { bg: 'bg-ink/5',      text: 'text-ink/45',     dot: 'bg-ink/30',     label: 'Inactive'  },
  online:    { bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500',  label: 'Online'    },
  offline:   { bg: 'bg-ink/5',      text: 'text-ink/55',     dot: 'bg-ink/35',     label: 'Offline'   },
  pending:   { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500', label: 'Pending'   },
};

export function StatusChip({ status, label, size = 'sm' }: StatusChipProps) {
  const { bg, text, dot, label: defaultLabel } = MAP[status];
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold tracking-wide ${bg} ${text} ${px}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {label ?? defaultLabel}
    </span>
  );
}
