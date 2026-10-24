// L3 Duplicates: the same student repeated within the batch (agreed duplicate key: student code OR
// demo identifier, plus course and academic year), and students already active at this institution.
// Rows are never merged or deleted silently; every affected row gets an issue naming the others.
const { makeIssue } = require('./issueFactory');

function runL3(ctx) {
  const issues = [];
  const groups = new Map(); // duplicate key -> row numbers

  for (const row of ctx.rows) {
    const { studentCode, externalIdDemo, courseCode, academicYear } = row.fields;
    if (!courseCode || !academicYear) continue;
    const keys = [];
    if (studentCode) keys.push(`code:${studentCode}|${courseCode}|${academicYear}`);
    if (externalIdDemo) keys.push(`id:${externalIdDemo}|${courseCode}|${academicYear}`);
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row.rowNumber);
    }
  }

  // Combine both key types so a row gets one issue listing every row it duplicates.
  const related = new Map(); // row number -> { rows:Set, matchedOn:Set }
  for (const [key, rowNumbers] of groups) {
    if (rowNumbers.length < 2) continue;
    const matchedOn = key.startsWith('code:') ? 'studentCode' : 'externalIdDemo';
    for (const rowNumber of rowNumbers) {
      if (!related.has(rowNumber)) related.set(rowNumber, { rows: new Set(), matchedOn: new Set() });
      const entry = related.get(rowNumber);
      entry.matchedOn.add(matchedOn);
      for (const other of rowNumbers) if (other !== rowNumber) entry.rows.add(other);
    }
  }
  for (const [rowNumber, entry] of related) {
    const others = [...entry.rows].sort((a, b) => a - b);
    const matchedOn = [...entry.matchedOn].sort();
    const field = matchedOn.includes('studentCode') ? 'studentCode' : 'externalIdDemo';
    issues.push(makeIssue('L3_DUPLICATE_IN_BATCH', {
      rowNumber,
      field,
      message: `Row ${rowNumber}: the same student (matched on ${matchedOn.join(' and ')}) also appears in row${others.length > 1 ? 's' : ''} ${others.join(', ')} for the same course and year.`,
      evidence: { relatedRows: others, matchedOn },
      evidenceKey: others.join(','),
    }, ctx));
  }

  // Already active at this institution for the same academic year.
  for (const row of ctx.rows) {
    const student = ctx.rowInfo.get(row.rowNumber).registerStudent;
    if (!student) continue;
    const sameInstitution = (ctx.activeEnrolmentsByStudentRef.get(student.studentRef) || []).filter(
      (enrolment) => String(enrolment.institutionId) === String(ctx.batch.institutionId)
    );
    if (sameInstitution.length > 0) {
      const existing = sameInstitution[0];
      issues.push(makeIssue('L3_ALREADY_IN_REGISTER', {
        rowNumber: row.rowNumber,
        field: 'studentCode',
        message: `Row ${row.rowNumber}: ${row.fields.studentCode} already has an active enrolment at this institution for ${existing.academicYear} (course ${existing.courseCode}, state ${existing.state}).`,
        evidence: { enrolmentRef: existing.enrolmentRef, state: existing.state },
        evidenceKey: existing.enrolmentRef,
      }, ctx));
    }
  }
  return issues;
}

module.exports = { runL3 };
