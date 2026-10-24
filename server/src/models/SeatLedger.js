// Authoritative seat counter for one course + academic year + bucket.
// Invariant: 0 <= filled <= capacity. It is enforced three ways:
//   1. schema min values,
//   2. conditional updates in seatLedgerService (never read-then-write),
//   3. a MongoDB collection validator installed by ensureDatabaseSetup().
const mongoose = require('mongoose');

const seatLedgerSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
    regionId: { type: String, required: true },
    academicYear: { type: String, required: true },
    courseCode: { type: String, required: true },
    bucketCode: { type: String, required: true },
    capacity: { type: Number, required: true, min: 0 },
    filled: { type: Number, required: true, min: 0, default: 0 },
    countsWithinIntake: { type: Boolean, required: true },
    policyVersion: { type: String, required: true },
    sourceType: { type: String, required: true },
    // false when the bucket is no longer part of the active policy (kept for history).
    inActivePolicy: { type: Boolean, default: true },
  },
  { timestamps: true }
);

seatLedgerSchema.index({ courseId: 1, academicYear: 1, bucketCode: 1 }, { unique: true });
seatLedgerSchema.index({ institutionId: 1, academicYear: 1 });
seatLedgerSchema.index({ regionId: 1, academicYear: 1 });

// Collection-level validator (installed with collMod) - database-level protection of the invariant.
seatLedgerSchema.statics.collectionValidator = {
  $and: [
    { capacity: { $type: 'number', $gte: 0 } },
    { filled: { $type: 'number', $gte: 0 } },
    { $expr: { $lte: ['$filled', '$capacity'] } },
  ],
};

module.exports = mongoose.model('SeatLedger', seatLedgerSchema);
