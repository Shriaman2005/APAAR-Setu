// One uploaded CSV row while it is still staging data (spec 07: "Uploaded rows are staging data").
const mongoose = require('mongoose');
const { CSV_COLUMNS, IDENTITY_CHECK_STATUS } = require('../config/constants');

// Every CSV column is stored as text exactly as it will be validated.
const fieldDefinition = {};
for (const column of CSV_COLUMNS) fieldDefinition[column] = { type: String, default: '' };
const fieldsSchema = new mongoose.Schema(fieldDefinition, { _id: false });

const stagingRowSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
    // Spreadsheet row number: row 1 is the header, so the first student is row 2.
    rowNumber: { type: Number, required: true, min: 2 },
    // Original upload snapshot (read-only). Kept so corrections can be traced back.
    rawSafeFields: { type: fieldsSchema, required: true },
    // Current values, including the operator's saved corrections.
    fields: { type: fieldsSchema, required: true },
    included: { type: Boolean, default: true },
    exclusion: { reason: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date },
    // rowVersion increases on every correction/exclusion. Validation results are only current
    // when validatedRowVersion === rowVersion, which stops stale results being mistaken for current ones.
    rowVersion: { type: Number, default: 1 },
    validatedRowVersion: { type: Number, default: 0 },
    validationStatus: {
      type: String,
      enum: ['NOT_VALIDATED', 'VALID', 'HAS_ERRORS', 'HAS_WARNINGS', 'PENDING', 'STALE', 'EXCLUDED'],
      default: 'NOT_VALIDATED',
    },
    identityCheck: {
      status: { type: String, enum: Object.values(IDENTITY_CHECK_STATUS), default: IDENTITY_CHECK_STATUS.NOT_CHECKED },
      adapter: String,
      checkedAt: Date,
    },
    corrections: [
      {
        _id: false,
        field: String,
        from: String,
        to: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: Date,
      },
    ],
    lastValidatedAt: Date,
  },
  { timestamps: true }
);

stagingRowSchema.index({ batchId: 1, rowNumber: 1 }, { unique: true });
stagingRowSchema.index({ batchId: 1, validationStatus: 1 });

module.exports = mongoose.model('StagingRow', stagingRowSchema);
