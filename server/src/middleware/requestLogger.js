// Logs one line per request: id, method, route, status, duration and a safe actor reference.
// Query strings are dropped (they could contain one-time tokens) and bodies are never logged.
const crypto = require('crypto');
const logger = require('../utils/logger');

function requestLogger(enabled) {
  return (req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    if (!enabled) return next();
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('request', {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - started) / 1000000n),
        actor: req.user ? `${req.user.role}:${req.user.id}` : 'anonymous',
      });
    });
    return next();
  };
}

module.exports = { requestLogger };
