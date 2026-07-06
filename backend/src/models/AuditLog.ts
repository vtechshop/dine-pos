import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  hotelId:    { type: String, required: true },
  actorId:    { type: String, default: '' },
  actorRole:  { type: String, default: 'admin' },
  action:     { type: String, required: true },
  targetType: { type: String, default: '' },
  targetId:   { type: String, default: '' },
  metadata:   { type: mongoose.Schema.Types.Mixed, default: {} },
  ip:         { type: String, default: '' },
  createdAt:  { type: Date, default: Date.now },
}, { timestamps: false, versionKey: false });

// Efficient hotel-scoped queries sorted by newest first
auditLogSchema.index({ hotelId: 1, createdAt: -1 });
// Auto-delete logs older than 90 days
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 });

export default mongoose.model('AuditLog', auditLogSchema);
