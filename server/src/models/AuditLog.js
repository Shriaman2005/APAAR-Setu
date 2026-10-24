// Hash-chained audit event. Append-only by APPLICATION CONVENTION: the model refuses updates and
// deletes, but a person with direct database access could still rewrite data. The hash chain lets
// the verify-chain check DETECT such an uncoordinated change; it does not make MongoDB immutable.
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    sequence: { type: Number, required: true, unique: true },
    timestamp: { type: Date, required: true },
    actorRef: { type: String, required: true }, // user id, "anonymous" or "system"
    actorRole: { type: String },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityRef: { type: String, required: true },
    institutionId: { type: String, default: null }, // stored as text so it is hashed identically
    regionIds: { type: [String], default: [] },
    reason: { type: String, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} }, // safe, minimal details only
    eventPayloadHash: { type: String, required: true },
    previousHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { versionKey: false }
);

auditLogSchema.index({ institutionId: 1, sequence: -1 });
auditLogSchema.index({ regionIds: 1, sequence: -1 });
auditLogSchema.index({ entityType: 1, entityRef: 1, sequence: 1 });
auditLogSchema.index({ action: 1, sequence: -1 });

// Block ordinary application code from modifying or deleting audit events.
const blockedOperations = [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
];
for (const operation of blockedOperations) {
  auditLogSchema.pre(operation, function blockMutation() {
    throw new Error(`Audit events are append-only; "${operation}" is not allowed.`);
  });
}
auditLogSchema.pre('save', function blockResave() {
  if (!this.isNew) throw new Error('Audit events are append-only; an existing event cannot be saved again.');
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
