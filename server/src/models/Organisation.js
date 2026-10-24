// Issuer (degree-awarding body) or verifier organisation.
// Added to give the DEGREE_AWARDING_BODY and VERIFIER roles an explicit, checkable scope.
const mongoose = require('mongoose');
const { ORG_TYPES, ORG_STATUS } = require('../config/constants');

const organisationSchema = new mongoose.Schema(
  {
    orgCode: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    type: { type: String, enum: Object.values(ORG_TYPES), required: true },
    status: { type: String, enum: Object.values(ORG_STATUS), default: ORG_STATUS.PENDING },
    // Issuer scope: institutions whose students this body may issue demo credentials for.
    affiliatedInstitutionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Institution' }],
    verifierCategory: { type: String, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 500 },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decision: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: Date,
      reason: String,
    },
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Organisation', organisationSchema);
