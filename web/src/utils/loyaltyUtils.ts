// Tier thresholds computed from lifetimeSpend (in rupees).
// These are client-side thresholds — backend gap: ideally returned from GET /loyalty/config.

export type LoyaltyTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

interface TierConfig {
  tier: LoyaltyTier;
  minSpend: number;
  color: string;
  bg: string;
  border: string;
  text: string;
  icon: string;
}

export const TIER_CONFIG: TierConfig[] = [
  { tier: 'Platinum', minSpend: 30_000, color: '#7C3AED', bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', icon: '💎' },
  { tier: 'Gold',     minSpend: 15_000, color: '#B45309', bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  icon: '🥇' },
  { tier: 'Silver',   minSpend:  5_000, color: '#475569', bg: 'bg-slate-50',  border: 'border-slate-200',  text: 'text-slate-600',  icon: '🥈' },
  { tier: 'Bronze',   minSpend:      0, color: '#92400E', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: '🥉' },
];

export function getTier(lifetimeSpend: number): TierConfig {
  return TIER_CONFIG.find(t => lifetimeSpend >= t.minSpend) ?? TIER_CONFIG[TIER_CONFIG.length - 1]!;
}

export function isBirthdayToday(birthday: string | null | undefined): boolean {
  if (!birthday) return false;
  try {
    const bd = new Date(birthday);
    const now = new Date();
    return bd.getMonth() === now.getMonth() && bd.getDate() === now.getDate();
  } catch { return false; }
}

export function nextTierInfo(lifetimeSpend: number): { nextTier: LoyaltyTier; remaining: number } | null {
  const reversed = [...TIER_CONFIG].reverse(); // Bronze → Platinum
  const nextIdx = reversed.findIndex(t => t.minSpend > lifetimeSpend);
  if (nextIdx === -1) return null;
  const next = reversed[nextIdx]!;
  return { nextTier: next.tier, remaining: next.minSpend - lifetimeSpend };
}
