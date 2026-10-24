// Prototype credential. The QR encodes a URL with an opaque reference; it is NOT a signed
// verifiable credential (spec 08 section 5). verificationMode records exactly what is supported.
const mongoose = require('mongoose');
const { CREDENTIAL_STATUS } = require('../config/constants');

const credentialSchema = new mongoose.Schema(
  {
    credentialRef: { type: String, required: true, unique: true },
    studentRef: { type: String, required: true },
    enrolmentRef: { type: String, required: true },
    issuerOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true },
    credentialType: { type: String, enum: ['ENROLMENT_CERTIFICATE_DEMO', 'COMPLETION_CERTIFICATE_DEMO'], required: true },
    status: { type: String, enum: Object.values(CREDENTIAL_STATUS), default: CREDENTIAL_STATUS.ACTIVE },
    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    revokedAt: Date,
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revocationReason: String,
    verificationMode: { type: String, default: 'URL_REFERENCE_UNSIGNED_DEMO' },
    // What is printed on the demo certificate (minimum fields required for the credential).
    snapshot: {
      displayName: String,
      institutionName: String,
      programName: String,
      courseCode: String,
      academicYear: String,
      enrolmentState: String,
    },
    mockDigiLockerPush: { status: String, adapter: String, at: Date },
  },
  { timestamps: true }
);

credentialSchema.index({ studentRef: 1 });
credentialSchema.index({ issuerOrgId: 1, createdAt: -1 });
// Only one ACTIVE credential of each type per enrolment (makes issuance idempotent).
credentialSchema.index(
  { enrolmentRef: 1, credentialType: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' }, name: 'one_active_credential_per_type' }
);

module.exports = mongoose.model('Credential', credentialSchema);
