// Request throttling for login, public QR verification and other sensitive public endpoints.
// Uses the in-memory store, which is fine for one prototype process (documented limitation).
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function tooMany(message) {
  return (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
  };
}

function createRateLimiters(limits) {
  return {
    // Only FAILED logins count, so a legitimate user is not locked out by normal use.
    login: rateLimit({
      windowMs: limits.loginWindowMs,
      limit: limits.loginMaxFailures,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: tooMany('Too many failed sign-in attempts. Wait a few minutes and try again.'),
    }),
    publicVerify: rateLimit({
      windowMs: limits.publicVerifyWindowMs,
      limit: limits.publicVerifyMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: tooMany('Too many verification checks from this network. Wait a minute and try again.'),
    }),
    setPassword: rateLimit({
      windowMs: limits.setPasswordWindowMs,
      limit: limits.setPasswordMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: tooMany('Too many attempts. Wait a few minutes and try again.'),
    }),
    // Per signed-in verifier, so one verifier cannot flood students with requests.
    verificationRequests: rateLimit({
      windowMs: limits.verificationRequestWindowMs,
      limit: limits.verificationRequestMax,
      keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: tooMany('Too many verification requests. Try again later.'),
    }),
  };
}

module.exports = { createRateLimiters };
