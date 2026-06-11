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
  orderSource: 'dine-in' | 'takeaway' | 'swiggy' | 'zomato' | 'qr';
  isParcel: boolean;
  customerName: string;
  customerPhone: string;
  tableNumber: string;
  notes: string;
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
      unique: true,
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
    },
    customerPhone: {
      type: String,
      default: '',
    },
    tableNumber: {
      type: String,
      default: '',
    },
    notes: {
      type: String,
      default: '',
    },
    orderSource: {
      type: String,
      enum: ['dine-in', 'takeaway', 'swiggy', 'zomato', 'qr'],
      default: 'dine-in',
    },
  },
  { timestamps: true }
);

// Compound indexes for common query patterns
OrderSchema.index({ hotelId: 1, createdAt: -1 });                          // order list per hotel
OrderSchema.index({ hotelId: 1, status: 1, createdAt: -1 });               // filtered order list
OrderSchema.index({ hotelId: 1, orderSource: 1, createdAt: -1 });          // source filter (Swiggy/Zomato analytics)
OrderSchema.index({ createdAt: -1 });                                       // admin-wide report

export default mongoose.model<IOrder>('Order', OrderSchema);
