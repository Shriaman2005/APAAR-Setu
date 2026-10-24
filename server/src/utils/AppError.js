// An error that is safe to show to the user.
// status  - HTTP status code (400, 401, 403, 404, 409, 413, 415, 422, 429, 503 ...)
// code    - stable machine-readable code the frontend can rely on
// message - plain-language explanation (never a stack trace or secret)
// details - optional extra data, e.g. field errors or blocking reasons
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (code, message, details) => new AppError(400, code, message, details);
const unauthorized = (message = 'Please sign in to continue.', code = 'AUTH_REQUIRED') => new AppError(401, code, message);
const forbidden = (message = 'You do not have permission to perform this action.', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
// 404 is also used to conceal resources outside the caller's scope (spec 06 section 6).
const notFound = (message = 'The requested record was not found.', code = 'NOT_FOUND') => new AppError(404, code, message);
const conflict = (code, message, details) => new AppError(409, code, message, details);
const unprocessable = (code, message, details) => new AppError(422, code, message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
