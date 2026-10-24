// L7 Risk signals: patterns that deserve a human look. RISK_FLAG only - they never block the batch
// and never label anyone as fraudulent (spec 07 section 1 golden rule).
const { makeIssue } = require('./issueFactory');
const { RISK_RULESET } = require('./ruleset');
const { maskToken } = require('../../utils/mask');
const { sha256Hex } = require('../../utils/hash');

function runL7(ctx) {
  const issues = [];

  // 1. Shared synthetic contact token.
  const rowsByToken = new Map();
  for (const row of ctx.rows) {
    if (!ctx.rowInfo.get(row.rowNumber).valid.contactToken) continue;
    const token = row.fields.contactToken;
    if (!rowsByToken.has(token)) rowsByToken.set(token, []);
    rowsByToken.get(token).push(row);
  }
  for (const [token, rows] of rowsByToken) {
    const studentsInBatch = new Set(rows.map((row) => row.fields.studentCode || `row-${row.rowNumber}`)).size;
    const inRegister = (ctx.registerContactStudents.get(token) || new Set()).size;
    const total = studentsInBatch + inRegister;
    if (total < RISK_RULESET.sharedContactMinStudents) continue;
    for (const row of rows) {
      issues.push(makeIssue('L7_SHARED_CONTACT', {
        rowNumber: row.rowNumber,
        field: 'contactToken',
        message:
          `Row ${row.rowNumber}: contact token ${maskToken(token)} is shared by ${total} students (${studentsInBatch} in this batch, ` +
          `${inRegister} already in the register at this institution). Signal for review only.`,
        evidence: { sharedBy: total, inThisBatch: studentsInBatch, inRegister, threshold: RISK_RULESET.sharedContactMinStudents, tokenMasked: maskToken(token), rulesetVersion: RISK_RULESET.version },
        evidenceKey: sha256Hex(token).slice(0, 16),
      }, ctx));
    }
  }

  if (!ctx.policy) return issues;

  // 2. Admission recorded after the (synthetic) admission window closed.
  const { closesOn } = ctx.policy.admissionWindow;
  for (const row of ctx.rows) {
    const { valid } = ctx.rowInfo.get(row.rowNumber);
    if (valid.admittedOn && row.fields.admittedOn > closesOn) {
      issues.push(makeIssue('L7_LATE_ADDITION', {
        rowNumber: row.rowNumber,
        field: 'admittedOn',
        message: `Row ${row.rowNumber}: admission dated ${row.fields.admittedOn}, after the configured window closed on ${closesOn}. Signal for review only.`,
        evidence: { admittedOn: row.fields.admittedOn, closesOn, rulesetVersion: RISK_RULESET.version },
      }, ctx));
    }
  }

  // 3. Unusually high share of additional (supernumerary) bucket rows in one batch.
  const bucketRows = ctx.rows.filter((row) => {
    const { valid } = ctx.rowInfo.get(row.rowNumber);
    return valid.courseCode && valid.bucketCode && ctx.ledgersByKey.has(`${row.fields.courseCode}|${row.fields.bucketCode}`);
  });
  if (bucketRows.length >= RISK_RULESET.additionalBucketMinRows) {
    const additional = bucketRows.filter(
      (row) => ctx.ledgersByKey.get(`${row.fields.courseCode}|${row.fields.bucketCode}`).countsWithinIntake === false
    );
    const share = additional.length / bucketRows.length;
    if (share > RISK_RULESET.additionalBucketShareThreshold) {
      issues.push(makeIssue('L7_ADDITIONAL_BUCKET_RATIO', {
        rowNumber: null,
        field: 'bucketCode',
        message:
          `${additional.length} of ${bucketRows.length} rows (${Math.round(share * 100)}%) use additional buckets that do not count within approved intake. ` +
          'Signal for review only.',
        evidence: { additionalRows: additional.length, totalRows: bucketRows.length, share: Number(share.toFixed(2)), threshold: RISK_RULESET.additionalBucketShareThreshold, rulesetVersion: RISK_RULESET.version },
        evidenceKey: `${additional.length}/${bucketRows.length}`,
      }, ctx));
    }
  }
  return issues;
}

module.exports = { runL7 };
