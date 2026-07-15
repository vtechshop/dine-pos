export interface PlanLimits {
  devices: number; // -1 = unlimited
  pricePerMonth: number; // INR
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  trial:        { devices: 2,  pricePerMonth: 0     },
  starter:      { devices: 2,  pricePerMonth: 999   },
  professional: { devices: 5,  pricePerMonth: 4999  },
  enterprise:   { devices: -1, pricePerMonth: 9999  },
  none:         { devices: 1,  pricePerMonth: 0     },
};

export const getDeviceLimitForPlan = (plan: string): number =>
  PLAN_LIMITS[plan]?.devices ?? 2;

export const getPriceForPlan = (plan: string): number =>
  PLAN_LIMITS[plan]?.pricePerMonth ?? 0;
