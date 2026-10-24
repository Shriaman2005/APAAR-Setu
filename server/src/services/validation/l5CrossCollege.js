// L5 Cross-college: the student already appears to hold an active enrolment at ANOTHER institution
// in the same academic year. Outcome is a WARNING (plus a conflict case after commit) - false
// positives are possible, so this is never treated as proof of wrongdoing.
const { makeIssue } = require('./issueFactory');

function runL5(ctx) {
  const issues = [];
  for (const row of ctx.rows) {
    const student = ctx.rowInfo.get(row.rowNumber).registerStudent;
    if (!student) continue;
    const elsewhere = (ctx.activeEnrolmentsByStudentRef.get(student.studentRef) || []).filter(
      (enrolment) => String(enrolment.institutionId) !== String(ctx.batch.institutionId)
    );
    if (elsewhere.length === 0) continue;
    // Minimum detail about the other institution: its name only (no course, bucket or dates).
    const names = [...new Set(elsewhere.map((enrolment) => ctx.institutionNames.get(String(enrolment.institutionId)) || 'another institution'))];
    issues.push(makeIssue('L5_ACTIVE_ENROLMENT_ELSEWHERE', {
      rowNumber: row.rowNumber,
      field: 'studentCode',
      message:
        `Row ${row.rowNumber}: ${row.fields.studentCode} appears to hold an active enrolment at ${names.join(', ')} for ${ctx.batch.academicYear}. ` +
        'If this batch is committed, a conflict case will be opened for review. This is not a finding of wrongdoing.',
      evidence: { otherInstitutions: names, activeElsewhere: elsewhere.length },
      evidenceKey: elsewhere.map((enrolment) => enrolment.enrolmentRef).sort().join(','),
    }, ctx));
  }
  return issues;
}

module.exports = { runL5 };
