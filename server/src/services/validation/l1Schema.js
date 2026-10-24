// L1 Schema: required fields, value shapes, dates and configured enum values (course, bucket).
const { makeIssue } = require('./issueFactory');
const { isValidAcademicYear, isValidIsoDate } = require('../../utils/dates');

const STUDENT_CODE = /^[A-Z0-9][A-Z0-9-]{1,29}$/;
const PERSON_NAME = /^\p{L}[\p{L} .'-]{0,119}$/u;
const SHORT_CODE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
const CONTACT_TOKEN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
const LOOKS_LIKE_PHONE_NUMBER = /^\+?\d[\d\s-]{8,}$/;
const YEAR_OF_STUDY = /^\d{1,2}$/;

const LABELS = {
  studentCode: 'Student code',
  studentName: 'Student name',
  courseCode: 'Course code',
  academicYear: 'Academic year',
  bucketCode: 'Bucket code',
  externalIdDemo: 'Demo external identifier',
  contactToken: 'Contact token',
  yearOfStudy: 'Year of study',
  admittedOn: 'Admitted on',
};

function requiredFields(ruleset) {
  const fields = ['studentCode', 'studentName', 'courseCode', 'academicYear', 'bucketCode'];
  if (ruleset.mockIdentityCheckEnabled) fields.push('externalIdDemo');
  if (ruleset.requireYearOfStudy) fields.push('yearOfStudy');
  if (ruleset.requireAdmittedOn) fields.push('admittedOn');
  return fields;
}

function runL1(ctx) {
  const issues = [];
  const required = requiredFields(ctx.ruleset);
  const permittedCourses = [...ctx.coursesByCode.keys()];
  const permittedBuckets = [...ctx.policyBucketCodes];

  for (const row of ctx.rows) {
    const values = row.fields;
    const info = ctx.rowInfo.get(row.rowNumber);
    const valid = info.valid;
    const add = (ruleCode, field, message, evidence) =>
      issues.push(makeIssue(ruleCode, { rowNumber: row.rowNumber, field, message, evidence }, ctx));

    for (const field of required) {
      if (!values[field]) add('L1_REQUIRED_FIELD', field, `Row ${row.rowNumber}: ${LABELS[field]} is required.`);
    }

    if (values.studentCode) {
      valid.studentCode = STUDENT_CODE.test(values.studentCode);
      if (!valid.studentCode) {
        add('L1_INVALID_FORMAT', 'studentCode', `Row ${row.rowNumber}: student code must be 2-30 letters, digits or hyphens (for example STU-001).`);
      }
    }
    if (values.studentName) {
      valid.studentName = PERSON_NAME.test(values.studentName);
      if (!valid.studentName) {
        add('L1_INVALID_FORMAT', 'studentName', `Row ${row.rowNumber}: student name may contain only letters, spaces, dots, apostrophes and hyphens (max 120 characters).`);
      }
    }
    if (values.courseCode) {
      if (!SHORT_CODE.test(values.courseCode)) {
        add('L1_INVALID_FORMAT', 'courseCode', `Row ${row.rowNumber}: course code format is invalid.`);
      } else if (!ctx.coursesByCode.has(values.courseCode)) {
        add('L1_INVALID_VALUE', 'courseCode',
          `Row ${row.rowNumber}: course code "${values.courseCode}" is not configured for this institution in ${ctx.batch.academicYear}.`,
          { permittedValues: permittedCourses });
      } else {
        valid.courseCode = true;
      }
    }
    if (values.academicYear) {
      valid.academicYear = isValidAcademicYear(values.academicYear);
      if (!valid.academicYear) {
        add('L1_INVALID_FORMAT', 'academicYear', `Row ${row.rowNumber}: academic year must look like 2026-27.`);
      }
    }
    if (values.bucketCode && ctx.policy) {
      if (!ctx.policyBucketCodes.has(values.bucketCode)) {
        add('L1_INVALID_VALUE', 'bucketCode',
          `Row ${row.rowNumber}: bucket code "${values.bucketCode}" is not in the active seat policy ${ctx.policy.version}.`,
          { permittedValues: permittedBuckets });
      } else {
        valid.bucketCode = true;
      }
    }
    if (values.contactToken) {
      if (LOOKS_LIKE_PHONE_NUMBER.test(values.contactToken)) {
        add('L1_INVALID_FORMAT', 'contactToken',
          `Row ${row.rowNumber}: contact token looks like a real phone number. Use a synthetic token such as PHONE-DEMO-A.`);
      } else if (!CONTACT_TOKEN.test(values.contactToken)) {
        add('L1_INVALID_FORMAT', 'contactToken', `Row ${row.rowNumber}: contact token must be 3-40 letters, digits or hyphens.`);
      } else {
        valid.contactToken = true;
      }
    }
    if (values.yearOfStudy) {
      const number = Number(values.yearOfStudy);
      valid.yearOfStudy = YEAR_OF_STUDY.test(values.yearOfStudy) && number >= 1 && number <= ctx.ruleset.maxYearOfStudy;
      if (valid.yearOfStudy) {
        info.yearOfStudy = number;
      } else {
        add('L1_INVALID_FORMAT', 'yearOfStudy', `Row ${row.rowNumber}: year of study must be a whole number from 1 to ${ctx.ruleset.maxYearOfStudy}.`);
      }
    }
    if (values.admittedOn) {
      valid.admittedOn = isValidIsoDate(values.admittedOn);
      if (!valid.admittedOn) {
        add('L1_INVALID_FORMAT', 'admittedOn', `Row ${row.rowNumber}: admitted-on date must be a real date in YYYY-MM-DD format.`);
      }
    }
  }
  return issues;
}

module.exports = { runL1, LABELS, requiredFields };
