// Rule-based risk case for the AICTE review queue (spec 04 sections 5-6).
// Added collection: spec 06 lists no risk collection, but the risk queue needs assignment,
// notes and review state. A risk score is an investigation priority, NOT a probability of fraud.
const mongoose = require('mongoose');
const { RISK_CASE_STATUS } = require('../config/constants');

const riskCaseSchema = new mongoose.Schema(
  {
    riskCaseId: { type: String, required: true, unique: true },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
    regionId: { type: String, required: true },
    academicYear: { type: String, required: true },
    // Identifies the pattern, e.g. "SHARED_CONTACT:<hash of token>", so re-evaluation updates the same case.
    signalKey: { type: String, required: true },
    ruleCode: { type: String, required: true },
    rulesetVersion: { type: String, required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], required: true },
    reasons: { type: [String], default: [] },
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Every evaluation snapshot is appended; nothing is deleted, even after a false-positive review.
    evidenceHistory: [{ _id: false, evidence: mongoose.Schema.Types.Mixed, score: Number, at: Date }],
    status: { type: String, enum: Object.values(RISK_CASE_STATUS), default: RISK_CASE_STATUS.OPEN },
    isOpen: { type: Boolean, default: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: [
      {
        _id: false,
        text: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        byRole: String,
        at: Date,
      },
    ],
    review: { summary: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date },
    falsePositive: { reason: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date },
    escalation: { reason: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date },
    events: [
      {
        _id: false,
        // A key literally named "type" must be written as { type: String } in Mongoose.
        type: { type: String },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        byRole: String,
        message: String,
        at: { type: Date, default: Date.now },
      },
    ],
    firstDetectedAt: { type: Date, default: Date.now },
    lastEvaluatedAt: Date,
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

riskCaseSchema.index({ institutionId: 1, academicYear: 1, signalKey: 1 }, { unique: true });
riskCaseSchema.index({ regionId: 1, isOpen: 1, score: -1 });

module.exports = mongoose.model('RiskCase', riskCaseSchema);
