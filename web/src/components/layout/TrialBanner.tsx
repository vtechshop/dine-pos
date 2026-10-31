import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getSaasStatus } from '../../api/saasBilling';

/**
 * Free-trial reminder as a small pill in the top bar (it used to take a full-width row).
 * Amber normally; red with a link to subscribe in the last 3 days.
 */
export function TrialBanner() {
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getSaasStatus()
      .then(data => {
        if (data.status === 'trial' && data.trialDaysRemaining != null) {
          setDaysRemaining(data.trialDaysRemaining);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || daysRemaining === null) return null;

  const isUrgent = daysRemaining <= 3;
  const full = daysRemaining === 0
    ? 'Your free trial expires today'
    : `Free trial: ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`;
  const short = daysRemaining === 0 ? 'Trial ends today' : `Trial · ${daysRemaining}d left`;

  const cls = `mr-1 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
    isUrgent ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-amber-200 bg-amber-50 text-amber-800'
  }`;

  return isUrgent ? (
    <Link to="/subscription" title={`${full} — subscribe now`} className={cls}>
      {short}<span className="hidden sm:inline"> · Subscribe</span>
    </Link>
  ) : (
    <span title={full} className={cls}>{short}</span>
  );
}
