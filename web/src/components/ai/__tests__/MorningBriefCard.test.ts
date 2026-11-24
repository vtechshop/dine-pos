// Hotfix: the admin dashboard crashed ("Cannot read properties of null (reading 'toFixed')")
// whenever today's morning brief existed — the server stores estimatedProfit and
// estimatedProfitMarginPct as null, and the card formatted them unconditionally.
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { MorningBrief } from '../../../api/morningBrief';

vi.mock('../../../context/SettingsContext', () => ({ useSettings: () => ({ settings: { currencySymbol: '₹' } }) }));
const { MorningBriefCard } = await import('../MorningBriefCard');

function brief(profit: number | null, margin: number | null): MorningBrief {
  return {
    _id: 'b1', date: '2026-11-24', generatedAt: '2026-11-24T02:30:00.000Z',
    business: {
      revenue: 12500, orders: 48, estimatedProfit: profit, estimatedProfitMarginPct: margin, avgBill: 260.42,
      healthScore: 78, healthGrade: 'B', topSellingItem: 'Veg Biryani', topSellingItemRevenue: 3600, topSellingItemQty: 20,
      peakHour: 13, topPaymentMethod: 'upi', revenueVs7DayAvgPct: 4.2, ordersVs7DayAvgPct: null, cancelledOrders: 1, cancelRate: 2.1,
    },
    menu: { topMenuItems: [{ name: 'Veg Biryani', revenue: 3600, qty: 20 }], slowMovers: [] },
    inventory: { criticalItems: [], warningItems: [], overstockItems: [], reorderRequiredNames: [], totalReorderCost: 0, criticalCount: 0, warningCount: 0 },
    forecast: { expectedRevenue: 13000, expectedOrders: 50, expectedAov: 260, topBusyHours: [13, 20], forecastConfidence: 0.7, method: 'avg' },
    executiveSummary: 'Steady day.', recommendations: [], opportunity: '', warning: null,
  };
}

describe('MorningBriefCard', () => {
  it('renders a brief without a profit estimate (as the server stores it today) instead of crashing', () => {
    const html = renderToString(createElement(MorningBriefCard, { defaultExpanded: true, brief: brief(null, null) }));
    expect(html).toContain('Est. Profit');
    expect(html).toContain('not estimated');
    expect(html).not.toContain('NaN');
  });

  it('still shows the estimate when there is one', () => {
    const html = renderToString(createElement(MorningBriefCard, { defaultExpanded: true, brief: brief(3125, 25) }));
    expect(html).toContain('3,125');
    expect(html).toContain('25% margin est.');
  });
});
