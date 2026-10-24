// L4 Seat ledger: rows requesting a course/bucket must fit within the configured capacity.
// Each bucket is checked on its own, so legitimately configured additional buckets never trigger a
// generic "total exceeds intake" error (spec 07 "Valid additional seats" case).
// This is a preview: capacity is re-checked atomically inside the commit transaction.
const { makeIssue } = require('./issueFactory');

function runL4(ctx) {
  const issues = [];
  if (!ctx.policy) {
    issues.push(makeIssue('L4_NO_ACTIVE_POLICY', {
      rowNumber: null,
      field: null,
      message: `No seat policy is published for ${ctx.batch.academicYear}, so seat capacity cannot be checked.`,
    }, ctx));
    return issues;
  }

  const demand = new Map(); // "COURSE|BUCKET" -> staging rows in row order
  for (const row of ctx.rows) {
    const { valid } = ctx.rowInfo.get(row.rowNumber);
    if (!valid.courseCode || !valid.bucketCode) continue;
    const key = `${row.fields.courseCode}|${row.fields.bucketCode}`;
    if (!demand.has(key)) demand.set(key, []);
    demand.get(key).push(row);
  }

  ctx.ledgerImpact = [];
  for (const [key, rows] of demand) {
    const [courseCode, bucketCode] = key.split('|');
    const ledger = ctx.ledgersByKey.get(key);
    if (!ledger || !ledger.inActivePolicy) {
      for (const row of rows) {
        issues.push(makeIssue('L4_NO_SEAT_LEDGER', {
          rowNumber: row.rowNumber,
          field: 'bucketCode',
          message: `Row ${row.rowNumber}: no seats are configured for bucket ${bucketCode} in course ${courseCode} for ${ctx.batch.academicYear} (policy ${ctx.policy.version}).`,
          evidenceKey: key,
        }, ctx));
      }
      continue;
    }
    const remaining = Math.max(0, ledger.capacity - ledger.filled);
    ctx.ledgerImpact.push({
      courseCode, bucketCode, capacity: ledger.capacity, filled: ledger.filled, requested: rows.length, remaining,
    });
    rows.slice(remaining).forEach((row, index) => {
      const position = remaining + index + 1;
      issues.push(makeIssue('L4_BUCKET_CAPACITY_EXCEEDED', {
        rowNumber: row.rowNumber,
        field: 'bucketCode',
        message:
          `Row ${row.rowNumber}: bucket ${bucketCode} for ${courseCode} (${ctx.batch.academicYear}) has capacity ${ledger.capacity} ` +
          `with ${ledger.filled} already filled. This batch requests ${rows.length} seat(s) there, so this row would be ` +
          `reservation number ${ledger.filled + position} and exceed capacity.`,
        evidence: {
          courseCode, bucketCode, capacity: ledger.capacity, filled: ledger.filled, remaining, requestedInBatch: rows.length,
          policyVersion: ledger.policyVersion, sourceType: ledger.sourceType,
        },
        evidenceKey: `${key}|${ledger.capacity}|${ledger.filled}|${position}`,
      }, ctx));
    });
  }
  return issues;
}

module.exports = { runL4 };
