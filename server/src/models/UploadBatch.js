// One CSV upload. Rows live in StagingRow until the batch is certified and committed.
const mongoose = require('mongoose');
const { BATCH_STATUS } = require('../config/constants');

const actorStampSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: Date,
    reason: String,
  },
  { _id: false }
);

const countsSchema = new mongoose.Schema(
  {
    totalRows: { type: Number, default: 0 },
    includedRows: { type: Number, default: 0 },
    excludedRows: { type: Number, default: 0 },
    validRows: { type: Number, default: 0 },
    rowsWithErrors: { type: Number, default: 0 },
    rowsWithWarnings: { type: Number, default: 0 },
    rowsPending: { type: Number, default: 0 },
    staleRows: { type: Number, default: 0 },
    openErrors: { type: Number, default: 0 },
    warnings: { type: Number, default: 0 },
    warningsNeedingJustification: { type: Number, default: 0 },
    dispositionsAwaitingHead: { type: Number, default: 0 },
    pendingChecks: { type: Number, default: 0 },
    riskFlags: { type: Number, default: 0 },
    infoNotes: { type: Number, default: 0 },
  },
  { _id: false }
);

const uploadBatchSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
    regionId: { type: String, required: true },
    academicYear: { type: String, required: true },
    sourceFileName: { type: String, required: true, maxlength: 120 },
    // SHA-256 of the file bytes: used to detect a repeated upload. It is NOT an authentication credential.
    fileHash: { type: String, required: true },
    fileSizeBytes: { type: Number, required: true },
    status: { type: String, enum: Object.values(BATCH_STATUS), required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    idempotencyKey: { type: String, maxlength: 100 },
    counts: { type: countsSchema, default: () => ({}) },
    validationRunCount: { type: Number, default: 0 },
    validationStartedAt: Date,
    lastValidatedAt: Date,
    validatedPolicyVersion: String,
    validationRulesetVersion: String,
    revalidationRequired: { type: Boolean, default: false },
    revalidationReason: String,
    readyForReview: { by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date, note: String },
    returnInfo: actorStampSchema,
    certification: {
      certifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      declarationVersion: String,
      declarationText: String,
      startedAt: Date,
      completedAt: Date,
    },
    commitSummary: {
      committedRows: Number,
      enrolmentsCreated: Number,
      studentsCreated: Number,
      provisionalEnrolments: Number,
      conflictsCreated: Number,
      ledgerChanges: [
        {
          _id: false,
          courseCode: String,
          bucketCode: String,
          reserved: Number,
          filledAfter: Number,
          capacity: Number,
        },
      ],
      policyVersion: String,
      committedAt: Date,
    },
    lastCommitError: { code: String, message: String, details: mongoose.Schema.Types.Mixed, at: Date },
    discarded: actorStampSchema,
    statusHistory: [
      {
        _id: false,
        from: String,
        to: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: String,
      },
    ],
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

uploadBatchSchema.index({ institutionId: 1, status: 1, createdAt: -1 });
uploadBatchSchema.index({ institutionId: 1, fileHash: 1 });
uploadBatchSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = mongoose.model('UploadBatch', uploadBatchSchema);
