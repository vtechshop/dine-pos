import mongoose, { Schema, Document } from 'mongoose';

// Single item in an order
export interface IOrderItem {
  product: mongoose.Types.ObjectId;
  productName: string;
  quantity: number;
  price: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
}

export interface IOrder extends Document {
  hotelId: mongoose.Types.ObjectId;
  orderNumber: string;
  offlineId: string | null;
  items: IOrderItem[];
  subtotal: number;
  taxTotal: number;
  discountAmount: number;
  grandTotal: number;
  paymentMethod: 'cash' | 'upi' | 'card' | 'split';
  splitDetails: {
    cash?: number;
    upi?: number;
    card?: number;
  };
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';
  orderSource: 'dine-in' | 'takeaway' | 'swiggy' | 'zomato' | 'qr' | 'kiosk' | 'waiter' | 'admin';
  isParcel: boolean;
  customerName: string;
  customerPhone: string;
  tableNumber: string;
  notes: string;
  servedBy: string;
  servedAt: Date | null;
  completedBy: string;
  completedAt: Date | null;
  cashierId: string;
  // ── Table Session / Guest Billing (Architecture v1.1) ───────────────────
  // null for takeaway, aggregator, and hotels with tableSessions=false
  sessionId: mongoose.Types.ObjectId | null;
  guestId: mongoose.Types.ObjectId | null;
  // ── Loyalty (Architecture v1.1) ─────────────────────────────────────────
  redeemedPoints: number;    // loyalty points redeemed against this order
  loyaltyDiscount: number;   // INR value of the loyalty discount applied
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema: Schema = new Schema({
  product: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
  },
  productName: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true,
  },
  taxPercent: {
    type: Number,
    default: 0,
  },
  taxAmount: {
    type: Number,
    default: 0,
  },
  total: {
    type: Number,
    required: true,
  },
});

const OrderSchema: Schema = new Schema(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    orderNumber: {
      type: String,
      required: true,
    },
    offlineId: {
      type: String,
    },
    items: [OrderItemSchema],
    subtotal: {
      type: Number,
      required: true,
    },
    taxTotal: {
      type: Number,
      required: true,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    grandTotal: {
      type: Number,
      required: true,
    },
    isParcel: {
      type: Boolean,
      default: false,
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'card', 'split'],
      default: 'cash',
    },
    splitDetails: {
      cash: { type: Number, default: 0 },
      upi: { type: Number, default: 0 },
      card: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'],
      default: 'pending',
    },
    customerName: {
      type: String,
      default: '',
      maxlength: [100, 'Customer name cannot exceed 100 characters'],
    },
    customerPhone: {
      type: String,
      default: '',
      maxlength: [20, 'Phone number cannot exceed 20 characters'],
    },
    tableNumber: {
      type: String,
      default: '',
      maxlength: [20, 'Table number cannot exceed 20 characters'],
    },
    notes: {
      type: String,
      default: '',
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    orderSource: {
      type: String,
      enum: ['dine-in', 'takeaway', 'swiggy', 'zomato', 'qr', 'kiosk', 'waiter', 'admin'],
      default: 'dine-in',
    },
    servedBy:    { type: String, default: '' },
    servedAt:    { type: Date, default: null },
    completedBy: { type: String, default: '' },
    completedAt: { type: Date, default: null },
    cashierId:   { type: String, default: '' },

    // ── Table Session / Guest Billing (Architecture v1.1) ─────────────────
    sessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', default: null },
    guestId:   { type: Schema.Types.ObjectId, ref: 'Guest',        default: null },

    // ── Loyalty (Architecture v1.1) ───────────────────────────────────────
    redeemedPoints:  { type: Number, default: 0, min: 0 },
    loyaltyDiscount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Compound indexes for common query patterns
OrderSchema.index({ hotelId: 1, orderNumber: 1 }, { unique: true });        // per-hotel unique order numbers — two hotels can share the same ORD-YYYYMMDD-NNN format without collision
OrderSchema.index({ hotelId: 1, createdAt: -1 });                           // order list per hotel
OrderSchema.index({ hotelId: 1, status: 1, createdAt: -1 });                // filtered order list
OrderSchema.index({ hotelId: 1, orderSource: 1, createdAt: -1 });           // source filter (Swiggy/Zomato analytics)
OrderSchema.index({ hotelId: 1, customerPhone: 1, createdAt: -1 });         // customer aggregation — skips null/empty phones efficiently
OrderSchema.index({ createdAt: -1 });                                        // admin-wide report
// Sparse unique index: null values are excluded, non-null offlineIds must be globally unique.
// This is the idempotency guard — a retry with the same offlineId is a no-op.
OrderSchema.index({ offlineId: 1 }, { unique: true, sparse: true });
// ── Table Session indexes (Architecture v1.1) ────────────────────────────
// Find all orders in a session (used by guest bill aggregation and cashier merged bill)
OrderSchema.index({ sessionId: 1 }, { sparse: true });
// Find orders for a specific guest (used by guest bill view — hot path)
OrderSchema.index({ guestId: 1 }, { sparse: true });
// Combined: all orders for a session filtered by guest (most common guest bill query)
OrderSchema.index({ sessionId: 1, guestId: 1 }, { sparse: true });
// Legacy table bill: menuRoutes filters by hotelId + tableNumber + createdAt (today's orders)
OrderSchema.index({ hotelId: 1, tableNumber: 1, createdAt: -1 });

export default mongoose.model<IOrder>('Order', OrderSchema);
