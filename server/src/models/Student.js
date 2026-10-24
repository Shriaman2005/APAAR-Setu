// Platform student identity. studentRef is a random internal reference (the primary key used
// across the platform); external identifiers are synthetic/mock only and never the primary key.
const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    studentRef: { type: String, required: true, unique: true },
    // Synthetic demo student code (e.g. STU-001). Used to match rows to an existing student in the demo.
    studentCode: { type: String, required: true, unique: true, trim: true, uppercase: true },
    displayName: { type: String, required: true, trim: true, maxlength: 120 },
    syntheticExternalId: { type: String, trim: true },
    externalLinkStatus: {
      type: String,
      enum: ['NOT_CHECKED', 'MATCHED', 'NAME_MISMATCH', 'NOT_FOUND', 'PENDING'],
      default: 'NOT_CHECKED',
    },
    nameHistory: [
      {
        from: String,
        to: String,
        reason: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: Date,
        correctionRequestId: String,
      },
    ],
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

studentSchema.index(
  { syntheticExternalId: 1 },
  { unique: true, partialFilterExpression: { syntheticExternalId: { $type: 'string' } } }
);

module.exports = mongoose.model('Student', studentSchema);
