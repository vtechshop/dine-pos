import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getSaasStatus } from '../../api/saasBilling';

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

  const bannerCls = isUrgent
    ? 'bg-red-50 border-b border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800/30 dark:text-red-300'
    : 'bg-amber-50 border-b border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800/30 dark:text-amber-300';

  const message = daysRemaining === 0
    ? 'Your free trial expires today.'
    : `Free trial: ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining.`;

  return (
    <div className={`flex shrink-0 items-center justify-between px-4 py-2 text-sm ${bannerCls}`}>
      <span>{message}</span>
      {isUrgent && (
        <Link
          to="/subscription"
          className="ml-4 shrink-0 rounded px-3 py-1 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
        >
          Subscribe Now
        </Link>
      )}
    </div>
  );
}
