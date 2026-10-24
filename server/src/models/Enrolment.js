// Official enrolment record. Created only by the certification commit (or the seed script),
// never directly from an upload.
const mongoose = require('mongoose');
const { ENROLMENT_STATE } = require('../config/constants');

const historySchema = new mongoose.Schema(
  {
    fromState: String, // null for the initial commit
    toState: { type: String, required: true },
    seatEffect: { type: String, enum: ['RESERVE', 'RELEASE', 'NONE'], required: true },
    reason: { type: String, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: String,
    at: { type: Date, default: Date.now },
    relatedConflictId: String,
    sourceBatchId: String,
  },
  { _id: false }
);

const enrolmentSchema = new mongoose.Schema(
  {
    enrolmentRef: { type: String, required: true, unique: true },
    studentRef: { type: String, required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
    regionId: { type: String, required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    courseCode: { type: String, required: true },
    academicYear: { type: String, required: true },
    yearOfStudy: { type: Number, required: true, min: 1 },
    bucketCode: { type: String, required: true },
    state: { type: String, enum: Object.values(ENROLMENT_STATE), required: true },
    // true while the enrolment occupies a seat. Cleared exactly once when the seat is released.
    seatHeld: { type: Boolean, required: true },
    admittedOn: { type: String, required: true },
    contactToken: { type: String }, // synthetic token used only by the shared-contact risk rule
    identityStatusAtCommit: { type: String },
    sourceBatchId: { type: String },
    sourceRowNumber: { type: Number },
    transferDestination: { enrolmentRef: String, conflictId: String },
    version: { type: Number, default: 1 },
    history: { type: [historySchema], default: [] },
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

enrolmentSchema.index({ studentRef: 1, academicYear: 1, state: 1 });
enrolmentSchema.index({ courseId: 1, academicYear: 1, bucketCode: 1, state: 1 });
enrolmentSchema.index({ institutionId: 1, academicYear: 1, state: 1 });
enrolmentSchema.index({ regionId: 1, academicYear: 1 });
// The same student cannot hold two seats in the same course/year at the same institution.
// (Different institutions are allowed so that cross-college conflicts can be detected, spec 06.)
enrolmentSchema.index(
  { studentRef: 1, institutionId: 1, courseId: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { seatHeld: true }, name: 'one_active_seat_per_course' }
);
// A staging row can be committed at most once.
enrolmentSchema.index(
  { sourceBatchId: 1, sourceRowNumber: 1 },
  { unique: true, partialFilterExpression: { sourceBatchId: { $type: 'string' } }, name: 'one_enrolment_per_staging_row' }
);

module.exports = mongoose.model('Enrolment', enrolmentSchema);
