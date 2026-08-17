import mongoose, { Schema, Document } from 'mongoose';

export type StockMovementType =
  | 'stock_in'       // Manual stock addition (via Stock In form)
  | 'restock'        // Legacy PATCH /restock
  | 'sale'           // Recipe-based deduction at order creation
  | 'sale_reversal'  // Restoration when order is cancelled
  | 'waste'          // Waste-log deduction
  | 'adjustment'     // Physical-count correction
  | 'opening_stock'  // Initial stock set when ingredient is created with stock > 0
  | 'grn'            // Goods-received note receipt
  | 'vendor_return'; // Return to vendor — stock removed, vendor outstanding reduced

export interface IStockMovement extends Document {
  hotelId: mongoose.Types.ObjectId;
  ingredientId: mongoose.Types.ObjectId;
  ingredientName: string;      // Snapshot — survives ingredient rename/delete
  type: StockMovementType;
  delta: number;               // Signed: +ve = stock added, -ve = stock removed
  previousStock: number;
  resultingStock: number;
  costPerUnit: number | null;
  totalCost: number | null;
  referenceId: string;         // orderId, wasteLogId, grnId, etc.
  referenceType: 'order' | 'grn' | 'waste' | 'manual' | 'vendor_return' | null;
  reason: string;
  notes: string;
  supplier: string;
  invoiceNumber: string;
  performedBy: string;         // Role / identifier from auth context
  createdAt: Date;
  updatedAt: Date;
}

const StockMovementSchema: Schema = new Schema(
  {
    hotelId:        { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    ingredientId:   { type: Schema.Types.ObjectId, ref: 'Ingredient', required: true },
    ingredientName: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['stock_in', 'restock', 'sale', 'sale_reversal', 'waste', 'adjustment', 'opening_stock', 'grn', 'vendor_return'],
      required: true,
    },
    delta:          { type: Number, required: true },
    previousStock:  { type: Number, required: true },
    resultingStock: { type: Number, required: true },
    costPerUnit:    { type: Number, default: null },
    totalCost:      { type: Number, default: null },
    referenceId:    { type: String, default: '' },
    referenceType:  { type: String, enum: ['order', 'grn', 'waste', 'manual', 'vendor_return', null], default: null },
    reason:         { type: String, default: '' },
    notes:          { type: String, default: '' },
    supplier:       { type: String, default: '' },
    invoiceNumber:  { type: String, default: '' },
    performedBy:    { type: String, default: '' },
  },
  { timestamps: true },
);

// Primary lookup: ingredient history, newest first
StockMovementSchema.index({ hotelId: 1, ingredientId: 1, createdAt: -1 });
// Hotel-wide movement log
StockMovementSchema.index({ hotelId: 1, createdAt: -1 });
// Reference lookups (order cancellation reversal audit)
StockMovementSchema.index({ referenceId: 1 }, { sparse: true });

export default mongoose.model<IStockMovement>('StockMovement', StockMovementSchema);
