export interface PlanLimits {
  devices:      number; // -1 = unlimited
  pricePerMonth: number; // INR (for display; actual billing uses saasAnnualPrice on Hotel)
  pricePerYear:  number; // INR standard yearly price
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  trial:        { devices: 2,  pricePerMonth: 0,     pricePerYear: 0       },
  standard:     { devices: -1, pricePerMonth: 1000,  pricePerYear: 12000   }, // DinePOS SaaS — ₹12,000/year, unlimited devices
  starter:      { devices: 2,  pricePerMonth: 999,   pricePerYear: 11988   },
  professional: { devices: 5,  pricePerMonth: 4999,  pricePerYear: 59988   },
  enterprise:   { devices: -1, pricePerMonth: 9999,  pricePerYear: 119988  },
  none:         { devices: 1,  pricePerMonth: 0,     pricePerYear: 0       },
};

export const SAAS_STANDARD_PRICE_INR  = 12_000; // ₹12,000/year
export const SAAS_STANDARD_PRICE_PAISE = 1_200_000; // in paise for Razorpay API

export const getDeviceLimitForPlan = (plan: string): number =>
  PLAN_LIMITS[plan]?.devices ?? 2;

export const getPriceForPlan = (plan: string): number =>
  PLAN_LIMITS[plan]?.pricePerMonth ?? 0;

export const getYearlyPriceForPlan = (plan: string): number =>
  PLAN_LIMITS[plan]?.pricePerYear ?? 0;
