import mongoose, { Schema, Document } from 'mongoose';

export interface IInquiry extends Document {
  type: 'contact' | 'demo';
  name: string;
  email: string;
  phone: string;
  restaurant: string;
  message: string;
  outlets: string;
  preferredDate: string;
  preferredTime: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const InquirySchema: Schema = new Schema(
  {
    type:          { type: String, enum: ['contact', 'demo'], required: true },
    name:          { type: String, required: true, maxlength: 100 },
    email:         { type: String, required: true, maxlength: 200 },
    phone:         { type: String, default: '', maxlength: 20 },
    restaurant:    { type: String, default: '', maxlength: 200 },
    message:       { type: String, default: '', maxlength: 2000 },
    outlets:       { type: String, default: '' },
    preferredDate: { type: String, default: '' },
    preferredTime: { type: String, default: '' },
    notes:         { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true },
);

InquirySchema.index({ createdAt: -1 });
InquirySchema.index({ type: 1, createdAt: -1 });

export default mongoose.model<IInquiry>('Inquiry', InquirySchema);
