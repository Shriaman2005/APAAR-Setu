// HTTP handlers for sign-in, sign-out and passwords.
const authService = require('../services/authService');
const { generateToken } = require('../middleware/csrf');
const { recordAudit } = require('../services/auditService');
const { User } = require('../models');

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
}

function destroySession(req) {
  return new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));
}

async function csrfToken(req, res) {
  res.json({ csrfToken: generateToken(req) });
}

// Used by password and demo sign-in alike. A new session id after login prevents session
// fixation (spec 03 section 2 step 3). Returns the new CSRF token.
async function startSession(req, user) {
  await regenerateSession(req);
  req.session.userId = String(user._id);
  req.session.sessionVersion = user.sessionVersion;
  req.session.authenticatedAt = new Date().toISOString();
  return generateToken(req, true);
}

async function login(req, res) {
  const user = await authService.verifyCredentials(req.validBody.email, req.validBody.password);
  const token = await startSession(req, user);
  res.json({ user: await authService.describeUser(user), csrfToken: token });
}

// Prototype demos only: the accounts offered for one-click sign-in (empty when DEMO_LOGIN is off).
async function demoAccounts(req, res) {
  const enabled = req.app.locals.config.demoLogin;
  res.json({ enabled, accounts: enabled ? await authService.listDemoAccounts() : [] });
}

async function demoLogin(req, res) {
  const user = await authService.demoSignIn(req.validBody.email);
  const token = await startSession(req, user);
  res.json({ user: await authService.describeUser(user), csrfToken: token });
}

// Idempotent: signing out twice still returns success.
async function logout(req, res) {
  const userId = req.session?.userId;
  const cookieName = req.app.locals.config.sessionCookieName;
  if (req.session) await destroySession(req);
  res.clearCookie(cookieName, { path: '/' });
  if (userId) {
    const user = await User.findById(userId, { role: 1 }).lean();
    if (user) await recordAudit({ actor: { id: userId, role: user.role }, action: 'AUTH_LOGOUT', entityType: 'User', entityRef: userId });
  }
  res.json({ loggedOut: true });
}

async function me(req, res) {
  const user = await User.findById(req.user.id).lean();
  res.json({ user: await authService.describeUser(user) });
}

async function changePassword(req, res) {
  const sessionVersion = await authService.changePassword(req.user, req.validBody.currentPassword, req.validBody.newPassword);
  // Other sessions are invalidated by the new sessionVersion; this one is rotated and kept.
  const userId = req.user.id;
  await regenerateSession(req);
  req.session.userId = userId;
  req.session.sessionVersion = sessionVersion;
  req.session.authenticatedAt = new Date().toISOString();
  res.json({ changed: true, csrfToken: generateToken(req, true) });
}

async function setPassword(req, res) {
  const result = await authService.setPasswordWithToken(req.validBody.token, req.validBody.newPassword);
  res.json({ passwordSet: true, purpose: result.purpose });
}

module.exports = { csrfToken, login, demoAccounts, demoLogin, logout, me, changePassword, setPassword };
