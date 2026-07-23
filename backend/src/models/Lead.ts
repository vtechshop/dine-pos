import { Schema, model, Document, Types } from 'mongoose';

export type LeadStatus = 'new' | 'contacted' | 'demo_scheduled' | 'proposal_sent' | 'won' | 'lost';
export type LeadPriority = 'low' | 'medium' | 'high';
export type LeadSource = 'website_contact' | 'website_demo' | 'referral' | 'social' | 'manual' | 'other';

export interface ILeadTimeline {
  event: string;
  note?: string;
  actor?: string;
  createdAt: Date;
}

export interface ILead extends Document {
  ownerName: string;
  companyName: string;
  phone: string;
  email: string;
  city?: string;
  state?: string;
  country: string;
  businessType?: string;
  restaurantType?: string;
  source: LeadSource;
  status: LeadStatus;
  assignedTo?: string;
  priority: LeadPriority;
  notes?: string;
  timeline: ILeadTimeline[];
  inquiryId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TimelineSchema = new Schema<ILeadTimeline>(
  {
    event:     { type: String, required: true },
    note:      { type: String },
    actor:     { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const LeadSchema = new Schema<ILead>(
  {
    ownerName:      { type: String, required: true, trim: true, maxlength: 100 },
    companyName:    { type: String, required: true, trim: true, maxlength: 200 },
    phone:          { type: String, required: true, trim: true, maxlength: 20 },
    email:          { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    city:           { type: String, trim: true, maxlength: 100 },
    state:          { type: String, trim: true, maxlength: 100 },
    country:        { type: String, default: 'India', trim: true, maxlength: 100 },
    businessType:   { type: String, trim: true, maxlength: 100 },
    restaurantType: { type: String, trim: true, maxlength: 100 },
    source:         { type: String, enum: ['website_contact', 'website_demo', 'referral', 'social', 'manual', 'other'], default: 'website_demo' },
    status:         { type: String, enum: ['new', 'contacted', 'demo_scheduled', 'proposal_sent', 'won', 'lost'], default: 'new' },
    assignedTo:     { type: String, trim: true, maxlength: 100 },
    priority:       { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    notes:          { type: String, maxlength: 5000 },
    timeline:       { type: [TimelineSchema], default: [] },
    inquiryId:      { type: Schema.Types.ObjectId, ref: 'Inquiry' },
  },
  { timestamps: true },
);

LeadSchema.index({ status: 1, createdAt: -1 });
LeadSchema.index({ email: 1 });
LeadSchema.index({ phone: 1 });
LeadSchema.index({ assignedTo: 1 });

export default model<ILead>('Lead', LeadSchema);
