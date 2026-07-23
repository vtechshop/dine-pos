export interface AggregatorOrderItem {
  productName:     string;
  quantity:        number;
  price:           number;
  taxPercent?:     number;
  notes?:          string;
  platformItemId?: string;
}

export interface ParsedAggregatorOrder {
  platformOrderId:     string;
  storeId:             string;
  event:               'new_order' | 'order_cancelled' | 'order_update';
  customerName:        string;
  customerPhone:       string;
  deliveryAddress:     string;
  items:               AggregatorOrderItem[];
  subtotal:            number;
  deliveryFee:         number;
  taxTotal:            number;
  grandTotal:          number;
  paymentMethod:       'prepaid' | 'cod';
  estimatedPickupTime?: string;
  notes?:              string;
}

export interface MenuSyncResult {
  success:      boolean;
  syncedCount:  number;
  failedCount:  number;
  failedItems:  { name: string; error: string }[];
  error?:       string;
}
