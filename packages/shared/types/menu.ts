// Shared menu-domain types — returned by GET /api/public/menu
// and used by both apps/web and apps/qr.

export interface FeatureFlags {
  payment?:                boolean;
  reservations?:           boolean;
  customerChat?:           boolean;
  qrOrdering?:             boolean;
  expenses?:               boolean;
  reports?:                boolean;
  tables?:                 boolean;
  ingredients?:            boolean;
  waste?:                  boolean;
  aggregator?:             boolean;
  tableSessions?:          boolean;
  customerIdentification?: 'disabled' | 'name_only' | 'name_mobile';
  customerDatabase?:       boolean;
  loyaltyProgram?:         boolean;
  birthdayOffers?:         boolean;
  whatsappNotifications?:  boolean;
  smsNotifications?:       boolean;
  digitalReceipts?:        boolean;
  customerOrderHistory?:   boolean;
  marketingCampaigns?:     boolean;
}

export interface Category {
  _id:       string;
  name:      string;
  icon:      string;
  color:     string;
  isActive:  boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  _id:         string;
  name:        string;
  price:       number;
  category:    { _id: string; name: string; color: string } | null;
  taxPercent:  number;
  hsnCode:     string;
  image:       string;
  isAvailable: boolean;
  isVeg:       boolean;
  shortCode:   string;
  description: string;
  stock:       number;  // -1 = unlimited
  isDeleted:   boolean;
  createdAt:   string;
  updatedAt:   string;
}
