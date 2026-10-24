// Student consent bound to purpose, fields and expiry (spec 08 section 3).
// Prototype record only: it is not a digitally signed consent artefact.
const mongoose = require('mongoose');
const { CONSENT_STATUS } = require('../config/constants');

const consentSchema = new mongoose.Schema(
  {
    consentId: { type: String, required: true, unique: true },
    requestId: { type: String, required: true, unique: true },
    studentRef: { type: String, required: true },
    verifierUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    verifierOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true },
    purpose: { type: String, required: true },
    requestedFields: { type: [String], required: true },
    approvedFields: { type: [String], default: [] },
    status: { type: String, enum: Object.values(CONSENT_STATUS), default: CONSENT_STATUS.PENDING },
    expiresAt: { type: Date, required: true },
    approvedAt: Date,
    deniedAt: Date,
    revokedAt: Date,
    decisionNote: { type: String, maxlength: 300 },
    // SHA-256 of the decision details: lets the student see a stable receipt reference.
    // It is a plain hash, not a signature.
    receiptHash: String,
    mode: { type: String, default: 'PROTOTYPE_UNSIGNED_CONSENT_RECORD' },
  },
  { timestamps: true }
);

consentSchema.index({ studentRef: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Consent', consentSchema);
