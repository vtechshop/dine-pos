import type { CustomerSummary } from '../../types/customers';

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
}

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  if (m) return `+91 ${m[1]} ${m[2]}`;
  return phone;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30)  return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function smartTag(c: CustomerSummary): { label: string; cls: string } | null {
  if (c.status === 'blocked') return { label: 'Blocked', cls: 'badge badge-error' };
  if (c._orderOnly)           return { label: 'History', cls: 'badge badge-neutral' };
  if (c.visitCount >= 10 || c.lifetimeSpend >= 10_000)
    return { label: 'VIP', cls: 'badge badge-warning' };
  if (c.visitCount >= 3)
    return { label: 'Regular', cls: 'badge badge-info' };
  return { label: 'New', cls: 'badge badge-success' };
}

interface Props {
  customer: CustomerSummary;
  isSelected: boolean;
  onClick(): void;
}

export function CustomerRow({ customer, isSelected, onClick }: Props) {
  const { name, phone, loyaltyBalance, visitCount, lastVisitAt } = customer;
  const tag = smartTag(customer);

  return (
    <button
      onClick={onClick}
      className={`w-full border-b border-border border-l-2 flex items-start gap-3 px-4 py-3 text-left transition-colors ${
        isSelected
          ? 'border-l-brand bg-brand-subtle'
          : 'border-l-transparent hover:bg-mist'
      }`}
    >
      {/* Avatar */}
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        customer.status === 'blocked' ? 'bg-error/10 text-error' : 'bg-brand-light text-brand'
      }`}>
        {initials(name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="truncate text-sm font-semibold text-ink">{name}</span>
          {tag && <span className={`${tag.cls} text-[9px] shrink-0`}>{tag.label}</span>}
        </div>
        <p className="mt-0.5 text-xs text-ink/40">{formatPhone(phone)}</p>
      </div>

      <div className="shrink-0 text-right">
        {customer._orderOnly ? (
          <>
            <p className="text-xs font-semibold text-ink/50 tabular-nums">{visitCount}×</p>
            <p className="mt-0.5 text-[10px] text-ink/30">{timeAgo(lastVisitAt)}</p>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-ink tabular-nums">
              {loyaltyBalance > 0 ? `${loyaltyBalance.toLocaleString()} pts` : '—'}
            </p>
            <p className="mt-0.5 text-[10px] text-ink/30">{visitCount}v · {timeAgo(lastVisitAt)}</p>
          </>
        )}
      </div>
    </button>
  );
}
