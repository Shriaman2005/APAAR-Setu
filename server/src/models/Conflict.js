// Cross-college conflict case: the same student appears to hold active enrolments at more than
// one institution in the same academic year. A case is a candidate for review, never a fraud verdict.
const mongoose = require('mongoose');
const { CONFLICT_STATUS, CONFLICT_TYPE } = require('../config/constants');

const conflictEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        'DETECTED', 'ENROLMENT_ADDED', 'INSTITUTION_RESPONSE', 'ENROLMENT_WITHDRAWN', 'ENROLMENT_TRANSFERRED',
        'JUSTIFICATION_SUBMITTED', 'JUSTIFICATION_ACCEPTED', 'JUSTIFICATION_REJECTED', 'ESCALATED', 'NOTE', 'RESOLVED',
      ],
      required: true,
    },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole: String,
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution' },
    message: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conflictSchema = new mongoose.Schema(
  {
    conflictId: { type: String, required: true, unique: true },
    studentRef: { type: String, required: true },
    academicYear: { type: String, required: true },
    conflictType: { type: String, enum: Object.values(CONFLICT_TYPE), required: true },
    status: { type: String, enum: Object.values(CONFLICT_STATUS), required: true },
    isOpen: { type: Boolean, required: true },
    enrolmentRefs: [
      {
        _id: false,
        enrolmentRef: String,
        institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution' },
        regionId: String,
        stateAtDetection: String,
      },
    ],
    involvedInstitutionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Institution' }],
    involvedRegionIds: [String],
    assignedRegionId: { type: String, required: true },
    escalationLevel: { type: String, enum: ['REGIONAL', 'NATIONAL'], default: 'REGIONAL' },
    dueAt: Date,
    justification: {
      institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution' },
      text: String,
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
    resolutionType: { type: String, enum: ['WITHDRAWN', 'TRANSFERRED', 'DROPPED', 'COMPLETED', 'JUSTIFIED'] },
    resolutionReason: String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    detectedBy: { type: String, enum: ['COMMIT_DETECTOR', 'SEED_DETECTOR'], required: true },
    events: { type: [conflictEventSchema], default: [] },
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

conflictSchema.index({ involvedInstitutionIds: 1, isOpen: 1 });
conflictSchema.index({ involvedRegionIds: 1, isOpen: 1 });
// At most one open case per student and academic year; new enrolments join the existing case.
conflictSchema.index(
  { studentRef: 1, academicYear: 1 },
  { unique: true, partialFilterExpression: { isOpen: true }, name: 'one_open_conflict_per_student_year' }
);

module.exports = mongoose.model('Conflict', conflictSchema);
