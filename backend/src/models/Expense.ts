import mongoose, { Schema, Document } from 'mongoose';

export interface IExpense extends Document {
  hotelId: mongoose.Types.ObjectId;
  description: string;
  amount: number;
  category: 'ingredients' | 'utilities' | 'staff' | 'maintenance' | 'rent' | 'other';
  date: Date;
  notes: string;
}

const ExpenseSchema: Schema = new Schema(
  {
    hotelId:     { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    description: { type: String, required: true, trim: true },
    amount:      { type: Number, required: true, min: 0 },
    category:    {
      type: String,
      enum: ['ingredients', 'utilities', 'staff', 'maintenance', 'rent', 'other'],
      default: 'other',
    },
    date:  { type: Date, required: true, default: Date.now },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

ExpenseSchema.index({ hotelId: 1, date: -1 });

export default mongoose.model<IExpense>('Expense', ExpenseSchema);
