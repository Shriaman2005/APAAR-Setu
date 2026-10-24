// Request validation with zod schemas. Schemas are .strict(), so unexpected fields (for example a
// role or institutionId sneaked into a request body) are rejected instead of silently ignored.
const { unprocessable } = require('../utils/AppError');

function formatIssues(error) {
  const fieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!fieldErrors[key]) fieldErrors[key] = [];
    fieldErrors[key].push(issue.code === 'unrecognized_keys' ? `Unexpected field(s): ${issue.keys.join(', ')}` : issue.message);
  }
  return fieldErrors;
}

function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) throw unprocessable('VALIDATION_FAILED', 'Some fields are missing or invalid.', { fieldErrors: formatIssues(result.error) });
    req.validBody = result.data;
    next();
  };
}

module.exports = { validateBody };
