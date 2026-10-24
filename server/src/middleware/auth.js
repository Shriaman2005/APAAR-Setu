// Authentication and role checks.
// The browser only holds an HttpOnly session cookie; the session (stored in MongoDB) holds the
// user id and sessionVersion. Every request reloads the user so disabled accounts, role/scope
// changes and password resets take effect immediately.
const { User } = require('../models');
const { USER_STATUS } = require('../config/constants');
const { unauthorized, forbidden } = require('../utils/AppError');

async function loadCurrentUser(req, _res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();
  const user = await User.findById(userId).lean();
  const valid = user && user.status === USER_STATUS.ACTIVE && user.sessionVersion === req.session.sessionVersion;
  if (!valid) {
    // Session belongs to a disabled/removed user or was revoked: forget it server-side.
    req.session.userId = undefined;
    req.session.sessionVersion = undefined;
    req.authProblem = 'SESSION_REVOKED';
    return next();
  }
  req.user = {
    id: String(user._id),
    role: user.role,
    displayName: user.displayName,
    email: user.emailNormalized,
    institutionId: user.institutionId || null,
    regionIds: user.regionIds || [],
    studentRef: user.studentRef || null,
    organisationId: user.organisationId || null,
  };
  return next();
}

function requireAuth(req, _res, next) {
  if (!req.user) {
    if (req.authProblem === 'SESSION_REVOKED') {
      throw unauthorized('Your session is no longer valid. Please sign in again.', 'SESSION_REVOKED');
    }
    throw unauthorized();
  }
  next();
}

// Usage: router.post('/x', requireRole('COLLEGE_HEAD'), handler)
// It also rejects unauthenticated requests (401), so a route only needs requireRole.
function requireRole(...roles) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!roles.includes(req.user.role)) throw forbidden();
      next();
    });
  };
}

module.exports = { loadCurrentUser, requireAuth, requireRole };
