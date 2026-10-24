// L6 Consistency: fields agree with the batch and the configured (synthetic) rules.
// Only the rules listed here are asserted; no unverified official policy is implied.
const { makeIssue } = require('./issueFactory');
const { todayIsoDate } = require('../../utils/dates');

function runL6(ctx) {
  const issues = [];
  const today = ctx.today || todayIsoDate();
  for (const row of ctx.rows) {
    const values = row.fields;
    const info = ctx.rowInfo.get(row.rowNumber);
    const { valid } = info;
    const add = (ruleCode, field, message, evidence) =>
      issues.push(makeIssue(ruleCode, { rowNumber: row.rowNumber, field, message, evidence }, ctx));

    if (valid.academicYear && values.academicYear !== ctx.batch.academicYear) {
      add('L6_ACADEMIC_YEAR_MISMATCH', 'academicYear',
        `Row ${row.rowNumber}: academic year ${values.academicYear} does not match the batch academic year ${ctx.batch.academicYear}.`);
    }
    if (valid.yearOfStudy && valid.courseCode) {
      const course = ctx.coursesByCode.get(values.courseCode);
      if (info.yearOfStudy > course.durationYears) {
        add('L6_YEAR_OF_STUDY_OUT_OF_RANGE', 'yearOfStudy',
          `Row ${row.rowNumber}: year of study ${info.yearOfStudy} is beyond the ${course.durationYears}-year duration configured for ${course.courseCode}.`,
          { durationYears: course.durationYears });
      }
    }
    if (valid.admittedOn) {
      if (values.admittedOn > today) {
        add('L6_ADMISSION_DATE_IN_FUTURE', 'admittedOn', `Row ${row.rowNumber}: admitted-on date ${values.admittedOn} is in the future.`);
      } else if (ctx.policy) {
        const { opensOn, closesOn } = ctx.policy.admissionWindow;
        if (values.admittedOn < opensOn || values.admittedOn > closesOn) {
          add('L6_ADMISSION_DATE_OUTSIDE_WINDOW', 'admittedOn',
            `Row ${row.rowNumber}: admitted-on date ${values.admittedOn} is outside the configured admission window ${opensOn} to ${closesOn} (synthetic policy ${ctx.policy.version}).`,
            { opensOn, closesOn });
        }
      }
    }
  }
  return issues;
}

module.exports = { runL6 };
