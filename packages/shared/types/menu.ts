// Shared menu-domain types — returned by GET /api/public/menu
// and used by both apps/web and apps/qr.

export interface ProductVariant {
  _id:   string;
  name:  string;
  price: number;
}

export interface ModifierOption {
  _id:          string;
  name:         string;
  price:        number;
  sku?:         string;
  barcode?:     string;
  isActive:     boolean;
  displayOrder: number;
}

export interface ModifierGroup {
  _id:           string;
  name:          string;
  description?:  string;
  isActive:      boolean;
  displayOrder:  number;
  isRequired:    boolean;
  selectionType: 'single' | 'multi';
  minSelections: number;
  maxSelections: number;
  options:       ModifierOption[];
}

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

export interface KitchenStation {
  _id:       string;
  name:      string;
  isActive:  boolean;
  sortOrder: number;
}

export interface RecipeItem {
  ingredient: { _id: string; name: string; unit: string; costPerUnit: number } | string;
  quantity:   number;
}

export interface Product {
  _id:            string;
  name:           string;
  price:          number;
  category:       { _id: string; name: string; color: string } | null;
  taxPercent:     number;
  hsnCode:        string;
  image:          string;
  imageSource?:   string | null;
  isAvailable:    boolean;
  isVeg:          boolean;
  shortCode:      string;
  barcode:        string;
  description:    string;
  stock:          number;  // -1 = not tracked
  isDeleted:      boolean;
  kitchenStation?: KitchenStation | null;
  recipe?:        RecipeItem[];
  variants?:      ProductVariant[];
  modifierGroups?: ModifierGroup[];
  createdAt:      string;
  updatedAt:      string;
}
