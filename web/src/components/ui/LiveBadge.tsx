interface LiveBadgeProps {
  label?: string;
  pulse?: boolean;
}

/**
 * Animated "new" badge — placed on a TableCard when a new order arrives,
 * or in the TopBar to show a live socket connection.
 */
export function LiveBadge({ label = 'NEW', pulse = true }: LiveBadgeProps) {
  return (
    <span className="relative inline-flex items-center gap-1 rounded-full bg-[#E8380D] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white shadow-sm">
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
        </span>
      )}
      {label}
    </span>
  );
}
