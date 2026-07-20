export interface CustomerSummary {
  _id: string;
  customerId: string;
  name: string;
  phone: string | null;
  loyaltyBalance: number;
  lifetimeSpend: number;
  visitCount: number;
  lastVisitAt: string | null;
  status: 'active' | 'blocked' | 'merged';
  /** Synthesized from /orders/customers — no loyalty profile exists for this customer */
  _orderOnly?: true;
}

export interface CustomerProfile extends CustomerSummary {
  hotelId: string;
  email: string | null;
  birthday: string | null;
  tags: string[];
  marketingOptIn: boolean;
  firstVisitAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type LoyaltyTransactionType =
  | 'earn'
  | 'redeem'
  | 'adjust'
  | 'expire'
  | 'transfer_in'
  | 'transfer_out';

export interface LoyaltyTransaction {
  _id: string;
  customerId: string;
  hotelId: string;
  orderId: string | null;
  sessionId: string | null;
  guestId: string | null;
  transactionType: LoyaltyTransactionType;
  points: number;
  balanceAfter: number;
  remarks: string;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface LoyaltyConfig {
  rewardName: string;
  pointsPerHundredRupees: number;
  minimumRedeemPoints: number;
  maximumRedeemPercent: number;
  pointValueInPaisa: number;
  expiryDays: number;
  roundingRule: 'floor' | 'round' | 'ceil';
  calculationBase: 'before_gst' | 'after_gst';
}

export interface CustomerSearchResult {
  customers: CustomerSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface CustomerTransactionsResult {
  customer: {
    customerId: string;
    name: string;
    phone: string | null;
    loyaltyBalance: number;
  };
  transactions: LoyaltyTransaction[];
  total: number;
  page: number;
  limit: number;
}
