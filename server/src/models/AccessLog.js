// Records every time a verifier retrieved consented data, so the student can see their access history.
const mongoose = require('mongoose');

const accessLogSchema = new mongoose.Schema(
  {
    accessRef: { type: String, required: true, unique: true },
    studentRef: { type: String, required: true },
    requestId: { type: String, required: true },
    consentId: { type: String, required: true },
    verifierUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    verifierOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true },
    verifierOrgName: { type: String, required: true },
    purpose: { type: String, required: true },
    fieldsDisclosed: { type: [String], required: true },
    accessedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

accessLogSchema.index({ studentRef: 1, accessedAt: -1 });

module.exports = mongoose.model('AccessLog', accessLogSchema);
