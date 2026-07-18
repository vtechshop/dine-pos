import type { CustomerSummary } from '../../types/customers';

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase();
}

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  return phone;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0)  return 'Today';
  if (days === 1)  return 'Yesterday';
  if (days < 30)   return `${days}d ago`;
  if (days < 365)  return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

interface Props {
  customer: CustomerSummary;
  isSelected: boolean;
  onClick: () => void;
}

export function CustomerRow({ customer, isSelected, onClick }: Props) {
  const { name, phone, loyaltyBalance, visitCount, lastVisitAt, status } = customer;

  return (
    <button
      onClick={onClick}
      className={`w-full border-b border-[#E8D5C0] border-l-2 flex items-start gap-3 px-4 py-3 text-left transition-colors ${
        isSelected
          ? 'border-l-[#E8380D] bg-[#E8380D]/[0.06]'
          : 'border-l-transparent hover:bg-[#1C0800]/[0.03]'
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          status === 'blocked'
            ? 'bg-red-100 text-red-600'
            : 'bg-[#E8380D]/15 text-[#E8380D]'
        }`}
      >
        {initials(name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-[#1C0800]">{name}</span>
          {status === 'blocked' && (
            <span className="shrink-0 rounded bg-red-50 px-1 text-[9px] font-semibold uppercase tracking-wide text-red-500">
              Blocked
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-[#1C0800]/40">{formatPhone(phone)}</p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-xs font-semibold text-[#1C0800] tabular-nums">
          {loyaltyBalance > 0 ? `${loyaltyBalance.toLocaleString()} pts` : '—'}
        </p>
        <p className="mt-0.5 text-[10px] text-[#1C0800]/30">
          {visitCount}v · {timeAgo(lastVisitAt)}
        </p>
      </div>
    </button>
  );
}
