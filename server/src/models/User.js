const mongoose = require('mongoose');
const { ALL_ROLES, USER_STATUS } = require('../config/constants');

const oneTimeTokenSchema = new mongoose.Schema(
  {
    tokenHash: String, // only the SHA-256 hash is stored; the token itself is shown once
    purpose: { type: String, enum: ['ACTIVATION', 'PASSWORD_RESET'] },
    expiresAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    emailNormalized: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    displayName: { type: String, required: true, trim: true, maxlength: 120 },
    // select:false means the hash is never loaded unless a query explicitly asks for it.
    passwordHash: { type: String, select: false },
    role: { type: String, enum: ALL_ROLES, required: true },
    status: { type: String, enum: Object.values(USER_STATUS), default: USER_STATUS.PENDING_ACTIVATION },
    institutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution' },
    regionIds: { type: [String], default: [] },
    studentRef: { type: String },
    organisationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation' },
    // Incremented to invalidate every existing session (disable, password reset, password change).
    sessionVersion: { type: Number, default: 0 },
    oneTimeToken: { type: oneTimeTokenSchema, select: false },
    passwordChangedAt: Date,
    lastLoginAt: Date,
    disabledReason: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// A student reference can belong to at most one login account.
userSchema.index({ studentRef: 1 }, { unique: true, partialFilterExpression: { studentRef: { $type: 'string' } } });
userSchema.index({ role: 1, status: 1 });

// Never send secrets to the browser, even by accident.
userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.oneTimeToken;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
