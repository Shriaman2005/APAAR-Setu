const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema(
  {
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', required: true },
    courseCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    programName: { type: String, required: true, trim: true, maxlength: 160 },
    level: { type: String, enum: ['UG', 'PG', 'DIPLOMA'], default: 'UG' },
    academicYear: { type: String, required: true },
    durationYears: { type: Number, required: true, min: 1, max: 6 },
    // Approval data comes from the MOCK approval adapter / synthetic fixture, never a real AICTE record.
    approvalRef: { type: String, required: true },
    approvalSource: { type: String, default: 'MOCK_AICTE_APPROVAL_FIXTURE' },
    approvedIntake: { type: Number, required: true, min: 0 },
    approvalFlags: { type: mongoose.Schema.Types.Mixed, default: {} },
    isDemo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

courseSchema.index({ institutionId: 1, academicYear: 1, courseCode: 1 }, { unique: true });

module.exports = mongoose.model('Course', courseSchema);
