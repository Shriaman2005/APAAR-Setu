const mongoose = require('mongoose');
const { CONSENT_STATUS } = require('../config/constants');

const verificationRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, unique: true },
    consentId: { type: String, required: true },
    studentRef: { type: String, required: true },
    verifierUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    verifierOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true },
    purpose: { type: String, required: true },
    requestedFields: { type: [String], required: true },
    // Mirrors the consent status so the verifier can see progress without reading the consent itself.
    status: { type: String, enum: Object.values(CONSENT_STATUS), default: CONSENT_STATUS.PENDING },
    expiresAt: { type: Date, required: true },
    resultReference: String, // last access-log reference
    lastAccessedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true }
);

verificationRequestSchema.index({ verifierUserId: 1, createdAt: -1 });

module.exports = mongoose.model('VerificationRequest', verificationRequestSchema);
