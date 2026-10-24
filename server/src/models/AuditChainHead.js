// Single document holding the latest sequence number and hash of the audit chain.
// Updating it with a compare-and-swap serialises appends, so two events can never claim
// the same sequence number.
const mongoose = require('mongoose');

const auditChainHeadSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'audit-chain' },
    sequence: { type: Number, required: true, default: 0 },
    lastHash: { type: String, required: true },
  },
  { versionKey: false }
);

module.exports = mongoose.model('AuditChainHead', auditChainHeadSchema);
