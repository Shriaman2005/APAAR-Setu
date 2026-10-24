// Turns every error into the standard JSON shape: { error: { code, message, details?, requestId } }.
// Stack traces and raw exception objects are logged on the server only, never sent to the browser.
const { AppError } = require('../utils/AppError');
const logger = require('../utils/logger');

function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No API route matches ${req.method} ${req.originalUrl.split('?')[0]}.`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, _next) {
  let status = 500;
  let body = { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server. Please try again.' };

  if (error instanceof AppError) {
    status = error.status;
    body = { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  } else if (error.code === 'CSRF_TOKEN_INVALID' || error.code === 'EBADCSRFTOKEN') {
    status = 403;
    body = { code: 'CSRF_TOKEN_INVALID', message: 'Security token missing or invalid. Refresh the page and try again.' };
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'MALFORMED_JSON', message: 'The request body is not valid JSON.' };
  } else if (error.type === 'entity.too.large') {
    status = 413;
    body = { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' };
  } else if (error.name === 'CastError') {
    status = 404;
    body = { code: 'NOT_FOUND', message: 'The requested record was not found.' };
  }

  if (status >= 500) {
    logger.error('Unhandled error', { requestId: req.requestId, path: req.originalUrl.split('?')[0], message: error.message, stack: error.stack });
  }
  res.status(status).json({ error: { ...body, requestId: req.requestId } });
}

module.exports = { notFoundHandler, errorHandler };
