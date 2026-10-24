// CSRF protection for cookie-authenticated, state-changing requests.
// Uses csrf-sync (maintained, Synchroniser Token Pattern): a random token is stored in the
// server-side session and must be echoed in the X-CSRF-Token header on every POST/PUT/PATCH/DELETE.
// GET/HEAD/OPTIONS are not protected, so GET endpoints must never change state.
const { csrfSync } = require('csrf-sync');

const { generateToken, csrfSynchronisedProtection } = csrfSync({
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
  errorConfig: { statusCode: 403, message: 'Security token missing or invalid. Refresh the page and try again.', code: 'CSRF_TOKEN_INVALID' },
});

module.exports = { generateToken, csrfProtection: csrfSynchronisedProtection };
