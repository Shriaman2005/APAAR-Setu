// A versioned seat-capacity rule set for one academic year.
// Draft -> pending approval -> published (previous published version becomes superseded).
const mongoose = require('mongoose');
const { POLICY_STATUS, SYNTHETIC_SOURCE_TYPE } = require('../config/constants');

const bucketSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    capacity: { type: Number, required: true, min: 0 },
    // true  = counts towards the course's approved intake
    // false = additional (supernumerary) bucket that does not use approved-intake seats
    countsWithinIntake: { type: Boolean, required: true },
  },
  { _id: false }
);

const scopeSchema = new mongoose.Schema(
  {
    institutionCode: { type: String, required: true, trim: true },
    courseCode: { type: String, required: true, trim: true, uppercase: true },
    buckets: { type: [bucketSchema], default: [] },
  },
  { _id: false }
);

const seatPolicySchema = new mongoose.Schema(
  {
    academicYear: { type: String, required: true },
    version: { type: String, required: true, trim: true, maxlength: 40 },
    status: { type: String, enum: Object.values(POLICY_STATUS), default: POLICY_STATUS.DRAFT },
    sourceType: { type: String, default: SYNTHETIC_SOURCE_TYPE },
    sourceReference: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, trim: true, maxlength: 1000 },
    // Synthetic admission window used by L6 date checks and L7 late-addition signals.
    admissionWindow: {
      opensOn: { type: String, required: true },
      closesOn: { type: String, required: true },
    },
    scopes: { type: [scopeSchema], default: [] },
    authoredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    effectiveAt: Date,
    supersededAt: Date,
    lastValidation: {
      status: { type: String, enum: ['PASSED', 'FAILED'] },
      errors: [String],
      warnings: [String],
      checkedAt: Date,
      checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      // Fingerprint of the content that was validated, so later edits force a new validation.
      contentHash: String,
    },
    rejection: {
      reason: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

seatPolicySchema.index({ academicYear: 1, version: 1 }, { unique: true });
// At most one published (active) policy per academic year.
seatPolicySchema.index(
  { academicYear: 1 },
  { unique: true, partialFilterExpression: { status: POLICY_STATUS.PUBLISHED }, name: 'one_published_per_year' }
);

module.exports = mongoose.model('SeatPolicy', seatPolicySchema);
