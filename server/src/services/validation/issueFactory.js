// Builds validation issue objects with consistent severity/blocking flags and a stable fingerprint.
const { getRule } = require('./ruleCatalog');
const { SEVERITY } = require('../../config/constants');
const { sha256Hex } = require('../../utils/hash');

/**
 * Decides whether an issue blocks the batch and whether it needs a maker/checker disposition.
 * @param {object} rule entry from the rule catalogue
 * @param {string} pendingPolicy current admin demo setting for PENDING identity checks
 */
function handlingFor(rule, pendingPolicy) {
  if (rule.severity === SEVERITY.ERROR) return { blocking: true, dispositionRequired: false };
  if (rule.severity === SEVERITY.WARNING) return { blocking: false, dispositionRequired: rule.disposition === 'JUSTIFY' };
  if (rule.severity === SEVERITY.PENDING) {
    return pendingPolicy === 'ALLOW_WITH_HEAD_DISPOSITION'
      ? { blocking: false, dispositionRequired: true }
      : { blocking: true, dispositionRequired: false };
  }
  return { blocking: false, dispositionRequired: false }; // INFO and RISK_FLAG
}

/**
 * @param {string} ruleCode
 * @param {object} details { rowNumber, field, message, evidence, evidenceKey }
 * @param {object} context { pendingPolicy }
 */
function makeIssue(ruleCode, details, context) {
  const rule = getRule(ruleCode);
  const rowNumber = details.rowNumber ?? null;
  const field = details.field ?? null;
  const evidenceKey = details.evidenceKey ?? '';
  return {
    rowNumber,
    field,
    layer: rule.layer,
    ruleCode,
    severity: rule.severity,
    message: details.message,
    correctionHint: rule.hint,
    evidence: details.evidence || {},
    ...handlingFor(rule, context.pendingPolicy),
    // Same rule + row + field + evidence key = "the same problem" across validation runs.
    fingerprint: sha256Hex(`${ruleCode}|${rowNumber}|${field}|${evidenceKey}`),
  };
}

module.exports = { makeIssue, handlingFor };
