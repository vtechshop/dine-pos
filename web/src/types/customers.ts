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
  anniversary: string | null;
  tags: string[];
  marketingOptIn: boolean;
  walletBalance: number;
  gstCustomer: boolean;
  companyName: string;
  gstin: string;
  deliveryAddresses: {
    label: string; line1: string; line2: string;
    city: string; state: string; pincode: string; isDefault: boolean;
  }[];
  favouriteItems: { productName: string; orderCount: number }[];
  firstVisitAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyStats {
  totalMembers:           number;
  totalOutstandingPoints: number;
  activeLast30:           number;
  pointsIssued:           number;
  pointsRedeemed:         number;
  pointsExpired:          number;
  pointsAdjusted:         number;
}

export interface LoyaltyActivityEntry {
  _id:             string;
  customerId:      { _id: string; name: string; phone: string | null; customerId: string } | string;
  transactionType: LoyaltyTransactionType;
  points:          number;
  balanceAfter:    number;
  remarks:         string;
  orderId:         string | null;
  createdAt:       string;
  createdBy:       string;
}

export type CampaignAudience =
  | 'all' | 'new' | 'repeat' | 'vip'
  | 'inactive30' | 'inactive60' | 'inactive90'
  | 'birthday' | 'anniversary' | 'loyalty' | 'noloyalty' | 'custom';

export type CampaignStatus = 'draft' | 'scheduled' | 'sent' | 'failed' | 'cancelled';

export interface Campaign {
  _id:             string;
  hotelId:         string;
  name:            string;
  channel:         'whatsapp' | 'sms';
  audience:        CampaignAudience;
  customAudience:  string[];
  messageTemplate: string;
  status:          CampaignStatus;
  scheduledAt:     string | null;
  sentAt:          string | null;
  recipientCount:  number;   // total audience size
  eligibleCount:   number;   // opted-in with phone (will actually receive)
  failureReason:   string;
  createdBy:       string;
  createdAt:       string;
  updatedAt:       string;
}

export type CustomerSegment =
  | 'all' | 'new' | 'repeat' | 'vip'
  | 'inactive30' | 'inactive60' | 'inactive90'
  | 'birthday' | 'anniversary'
  | 'birthdayweek' | 'anniversaryweek'
  | 'loyalty' | 'noloyalty';

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
