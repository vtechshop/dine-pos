import { useState, useEffect, useCallback } from 'react';
import { fetchCustomerTransactions } from '../../api/loyalty';
import type { LoyaltyTransaction, LoyaltyTransactionType } from '../../types/customers';
import { Spinner } from '../ui/Spinner';

const TYPE_CFG: Record<LoyaltyTransactionType, { label: string; cls: string }> = {
  earn:         { label: 'Earn',   cls: 'bg-green-50 text-green-700'  },
  redeem:       { label: 'Redeem', cls: 'bg-amber-50 text-amber-700'  },
  adjust:       { label: 'Adj',    cls: 'bg-blue-50 text-blue-700'    },
  expire:       { label: 'Exp',    cls: 'bg-gray-100 text-gray-500'   },
  transfer_in:  { label: 'In',     cls: 'bg-teal-50 text-teal-700'    },
  transfer_out: { label: 'Out',    cls: 'bg-red-50 text-red-600'      },
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

interface Props {
  customerId: string;
  rewardName: string;
}

export function TransactionHistory({ customerId, rewardName }: Props) {
  const [txns, setTxns]       = useState<LoyaltyTransaction[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async (pg: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCustomerTransactions(customerId, { page: pg, limit: 20 });
      setTotal(res.total);
      setTxns(prev => append ? [...prev, ...res.transactions] : res.transactions);
      setPage(pg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    setTxns([]);
    setPage(1);
    void load(1, false);
  }, [load]);

  if (loading && txns.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="sm" />
      </div>
    );
  }

  if (error) {
    return <p className="py-4 text-xs text-red-500">{error}</p>;
  }

  if (txns.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-ink/30">
        No {rewardName} transactions yet
      </p>
    );
  }

  return (
    <div>
      <div className="divide-y divide-border">
        {txns.map(tx => {
          const { label, cls } = TYPE_CFG[tx.transactionType];
          const positive = tx.points > 0;
          return (
            <div key={tx._id} className="flex items-start gap-3 py-2.5">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${cls}`}>
                {label}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-ink/70">{tx.remarks || '—'}</p>
                <p className="mt-0.5 text-[10px] text-ink/30">{fmtDateTime(tx.createdAt)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-xs font-semibold tabular-nums ${positive ? 'text-green-600' : 'text-red-500'}`}>
                  {positive ? '+' : ''}{tx.points}
                </p>
                <p className="mt-0.5 text-[10px] tabular-nums text-ink/30">
                  {tx.balanceAfter} bal
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {txns.length < total && (
        <button
          onClick={() => void load(page + 1, true)}
          disabled={loading}
          className="mt-3 w-full rounded-lg border border-border py-2 text-xs text-ink/50 hover:bg-ink/5 disabled:opacity-40"
        >
          {loading ? 'Loading…' : `Load more (${total - txns.length} remaining)`}
        </button>
      )}
    </div>
  );
}
