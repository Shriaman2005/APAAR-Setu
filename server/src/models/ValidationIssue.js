// One validation outcome for a row (or for the whole batch when rowNumber is null).
// Old outcomes are kept (current:false) so the history before/after correction is preserved.
const mongoose = require('mongoose');
const { SEVERITY, ISSUE_STATUS } = require('../config/constants');

const actorNoteSchema = new mongoose.Schema(
  {
    text: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: Date,
  },
  { _id: false }
);

const validationIssueSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
    rowNumber: { type: Number, default: null },
    field: { type: String, default: null },
    layer: { type: String, enum: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'], required: true },
    ruleCode: { type: String, required: true },
    severity: { type: String, enum: Object.values(SEVERITY), required: true },
    message: { type: String, required: true },
    correctionHint: { type: String },
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
    // blocking: prevents "ready for review" and certification while unresolved.
    blocking: { type: Boolean, required: true },
    // dispositionRequired: operator must justify and head must accept before certification.
    dispositionRequired: { type: Boolean, required: true },
    resolutionStatus: { type: String, enum: Object.values(ISSUE_STATUS), default: ISSUE_STATUS.OPEN },
    justification: actorNoteSchema,
    disposition: {
      decision: { type: String, enum: ['ACCEPTED'] },
      reason: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
    resolutionReason: String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    validationRun: { type: Number, required: true },
    rowVersion: { type: Number, default: null },
    fingerprint: { type: String, required: true },
    policyVersion: String,
    current: { type: Boolean, default: true },
  },
  { timestamps: true }
);

validationIssueSchema.index({ batchId: 1, current: 1, severity: 1 });
validationIssueSchema.index({ batchId: 1, rowNumber: 1 });

module.exports = mongoose.model('ValidationIssue', validationIssueSchema);
