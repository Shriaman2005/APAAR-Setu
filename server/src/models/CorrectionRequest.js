// A student's request to correct their official record. The record stays unchanged until an
// authorised institution user reviews the request (spec 04 section 10).
const mongoose = require('mongoose');

const correctionRequestSchema = new mongoose.Schema(
  {
    correctionRequestId: { type: String, required: true, unique: true },
    studentRef: { type: String, required: true },
    enrolmentRef: { type: String, required: true },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
    correctionType: { type: String, enum: ['NAME_CORRECTION', 'ENROLMENT_DETAIL'], required: true },
    explanation: { type: String, required: true, maxlength: 1000 },
    evidenceNote: { type: String, maxlength: 300 },
    proposedValue: { type: String, maxlength: 120 },
    status: { type: String, enum: ['SUBMITTED', 'ACCEPTED', 'REJECTED'], default: 'SUBMITTED' },
    decision: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      at: Date,
      response: String,
      appliedChange: String,
    },
  },
  { timestamps: true }
);

correctionRequestSchema.index({ institutionId: 1, status: 1, createdAt: -1 });
correctionRequestSchema.index({ studentRef: 1, createdAt: -1 });

module.exports = mongoose.model('CorrectionRequest', correctionRequestSchema);
