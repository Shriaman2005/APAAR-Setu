// Login, password changes and one-time activation/reset tokens.
const bcrypt = require('bcrypt');
const { User, Institution, Organisation } = require('../models');
const { USER_STATUS } = require('../config/constants');
const { AppError, unprocessable } = require('../utils/AppError');
const { sha256Hex } = require('../utils/hash');
const { recordAudit } = require('./auditService');

function bcryptRounds() {
  const value = Number.parseInt(process.env.BCRYPT_ROUNDS, 10);
  return Number.isInteger(value) && value >= 4 && value <= 15 ? value : 12;
}

// Used to keep response time similar whether or not the account exists (no account enumeration).
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = bcrypt.hash('not-a-real-password-just-for-timing', bcryptRounds());
  return dummyHashPromise;
}

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Password policy for the prototype: 12-128 characters with at least one letter and one digit,
 * and not containing the email name. Documented in SECURITY_AND_LIMITATIONS.md.
 */
function checkPasswordPolicy(password, email) {
  const problems = [];
  if (typeof password !== 'string' || password.length < 12) problems.push('at least 12 characters');
  if (typeof password === 'string' && password.length > 128) problems.push('at most 128 characters');
  if (!/[A-Za-z]/.test(password || '')) problems.push('at least one letter');
  if (!/\d/.test(password || '')) problems.push('at least one digit');
  const localPart = normaliseEmail(email).split('@')[0];
  if (localPart && localPart.length >= 4 && String(password).toLowerCase().includes(localPart)) problems.push('must not contain your email name');
  if (problems.length > 0) {
    throw unprocessable('PASSWORD_POLICY', `Password must have ${problems.join(', ')}.`, { fieldErrors: { newPassword: problems } });
  }
}

async function hashPassword(password) {
  return bcrypt.hash(password, bcryptRounds());
}

const INVALID_CREDENTIALS = () => new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect, or the account cannot sign in.');

/**
 * Checks credentials. The same generic error is used for unknown email, wrong password and
 * disabled/inactive accounts so attackers cannot learn which accounts exist.
 */
async function verifyCredentials(email, password) {
  const emailNormalized = normaliseEmail(email);
  const user = await User.findOne({ emailNormalized }).select('+passwordHash').lean();
  if (!user || !user.passwordHash || user.status !== USER_STATUS.ACTIVE) {
    await bcrypt.compare(String(password), await dummyHash());
    await recordAudit({ actor: 'anonymous', action: 'AUTH_LOGIN_FAILED', entityType: 'User', entityRef: 'unknown', payload: { emailHash: sha256Hex(emailNormalized).slice(0, 16) } });
    throw INVALID_CREDENTIALS();
  }
  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) {
    await recordAudit({ actor: 'anonymous', action: 'AUTH_LOGIN_FAILED', entityType: 'User', entityRef: String(user._id), payload: { emailHash: sha256Hex(emailNormalized).slice(0, 16) } });
    throw INVALID_CREDENTIALS();
  }
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  await recordAudit({ actor: { id: user._id, role: user.role }, action: 'AUTH_LOGIN_SUCCEEDED', entityType: 'User', entityRef: String(user._id), institutionId: user.institutionId, regionIds: user.regionIds });
  delete user.passwordHash;
  return user;
}

// Safe user summary for GET /api/auth/me (never includes hashes or tokens).
async function describeUser(user) {
  const [institution, organisation] = await Promise.all([
    user.institutionId ? Institution.findById(user.institutionId, { institutionCode: 1, name: 1, regionId: 1 }).lean() : null,
    user.organisationId ? Organisation.findById(user.organisationId, { orgCode: 1, name: 1, type: 1, status: 1 }).lean() : null,
  ]);
  return {
    id: String(user._id || user.id),
    email: user.emailNormalized,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    institution: institution ? { id: String(institution._id), code: institution.institutionCode, name: institution.name, regionId: institution.regionId } : null,
    regionIds: user.regionIds || [],
    studentRef: user.studentRef || null,
    organisation: organisation ? { id: String(organisation._id), code: organisation.orgCode, name: organisation.name, type: organisation.type, status: organisation.status } : null,
  };
}

async function changePassword(authUser, currentPassword, newPassword) {
  const user = await User.findById(authUser.id).select('+passwordHash').lean();
  if (!user || !user.passwordHash || !(await bcrypt.compare(String(currentPassword), user.passwordHash))) {
    throw unprocessable('CURRENT_PASSWORD_INCORRECT', 'Your current password is incorrect.', { fieldErrors: { currentPassword: ['incorrect'] } });
  }
  if (currentPassword === newPassword) throw unprocessable('PASSWORD_UNCHANGED', 'Choose a password different from your current one.');
  checkPasswordPolicy(newPassword, user.emailNormalized);
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    { $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() }, $inc: { sessionVersion: 1 } },
    { returnDocument: 'after' }
  ).lean();
  await recordAudit({ actor: authUser, action: 'AUTH_PASSWORD_CHANGED', entityType: 'User', entityRef: String(user._id) });
  return updated.sessionVersion;
}

/**
 * Completes account activation or an administrator-initiated reset with a one-time token.
 * Only the token's hash is stored, so a database reader cannot reuse it.
 */
async function setPasswordWithToken(token, newPassword) {
  const tokenHash = sha256Hex(String(token || ''));
  const user = await User.findOne({ 'oneTimeToken.tokenHash': tokenHash, 'oneTimeToken.expiresAt': { $gt: new Date() } })
    .select('+oneTimeToken').lean();
  if (!user || user.status === USER_STATUS.DISABLED) {
    throw unprocessable('INVALID_OR_EXPIRED_TOKEN', 'This link is invalid or has expired. Ask your system administrator for a new one.');
  }
  checkPasswordPolicy(newPassword, user.emailNormalized);
  const purpose = user.oneTimeToken.purpose;
  const result = await User.updateOne(
    { _id: user._id, 'oneTimeToken.tokenHash': tokenHash },
    {
      $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), status: USER_STATUS.ACTIVE },
      $unset: { oneTimeToken: 1 },
      $inc: { sessionVersion: 1 },
    }
  );
  if (result.modifiedCount !== 1) throw unprocessable('INVALID_OR_EXPIRED_TOKEN', 'This link was already used.');
  await recordAudit({ actor: { id: user._id, role: user.role }, action: 'AUTH_PASSWORD_SET', entityType: 'User', entityRef: String(user._id), payload: { purpose } });
  return { purpose };
}

module.exports = {
  normaliseEmail, checkPasswordPolicy, hashPassword, verifyCredentials, describeUser, changePassword, setPasswordWithToken, bcryptRounds,
};
