// Synthetic validation and risk ruleset (PROPOSED IMPLEMENTATION, not official policy).
// Every threshold here is a demo value chosen so the fixtures in /fixtures behave predictably.
const VALIDATION_RULESET = Object.freeze({
  version: 'VAL-RULES-DEMO-v1',
  // spec 10: externalIdDemo is required only when the mock identity check is configured.
  mockIdentityCheckEnabled: true,
  // spec 10: yearOfStudy and admittedOn are required "if the configured rule set requires it".
  requireYearOfStudy: true,
  requireAdmittedOn: true,
  maxYearOfStudy: 6,
});

const RISK_RULESET = Object.freeze({
  version: 'RISK-RULES-DEMO-v1',
  // A synthetic contact token shared by this many distinct students raises a signal.
  sharedContactMinStudents: 3,
  // A batch where more than this share of rows uses additional (supernumerary) buckets raises a signal...
  additionalBucketShareThreshold: 0.5,
  // ...but only when the batch has at least this many rows (small batches are too noisy).
  additionalBucketMinRows: 5,
  // Score bands. The score orders the review queue; it is NOT a probability of wrongdoing.
  highPriorityFrom: 70,
  mediumPriorityFrom: 40,
});

function priorityForScore(score) {
  if (score >= RISK_RULESET.highPriorityFrom) return 'HIGH';
  if (score >= RISK_RULESET.mediumPriorityFrom) return 'MEDIUM';
  return 'LOW';
}

module.exports = { VALIDATION_RULESET, RISK_RULESET, priorityForScore };
