// Catalogue of every validation rule: which layer it belongs to, its severity and how it may be
// handled. This table IS the explicit warning-disposition policy required by spec 07 section 3.
//
// disposition:
//   'NONE'      - errors must be corrected (or the row excluded); info/risk flags need no action
//   'JUSTIFY'   - operator records a justification, college head accepts it before certification
//   'SETTING'   - PENDING identity checks follow the admin demo setting "pendingIdentityPolicy"
const { SEVERITY } = require('../../config/constants');

const RULES = Object.freeze({
  // L1 Schema --------------------------------------------------------------------------------
  L1_REQUIRED_FIELD: {
    layer: 'L1', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Required field is missing',
    hint: 'Enter a value for this field and save the correction.',
  },
  L1_INVALID_FORMAT: {
    layer: 'L1', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Value has the wrong format',
    hint: 'Use the format described in the CSV template note.',
  },
  L1_INVALID_VALUE: {
    layer: 'L1', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Value is not one of the configured options',
    hint: 'Choose a value listed in the template note for your institution and academic year.',
  },
  // L2 External identity (MOCK) -------------------------------------------------------------
  L2_EXTERNAL_ID_FORMAT: {
    layer: 'L2', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Demo identifier format is invalid',
    hint: 'The synthetic demo identifier must be exactly 12 digits. This checks format only; it does not verify a real identity.',
  },
  L2_MOCK_NAME_MISMATCH: {
    layer: 'L2', severity: SEVERITY.WARNING, disposition: 'JUSTIFY',
    title: 'Name differs from the MOCK identity record',
    hint: 'Check the spelling. If the uploaded name is correct, record a justification for the college head.',
  },
  L2_MOCK_ID_NOT_FOUND: {
    layer: 'L2', severity: SEVERITY.WARNING, disposition: 'JUSTIFY',
    title: 'Identifier not found in the MOCK identity registry',
    hint: 'Check the identifier. If it is correct, record a justification for the college head.',
  },
  L2_IDENTITY_CHECK_PENDING: {
    layer: 'L2', severity: SEVERITY.PENDING, disposition: 'SETTING',
    title: 'Identity check could not be completed (mock service pending/unavailable)',
    hint: 'Retry later by revalidating the batch. The record is never shown as identity-verified while pending.',
  },
  L2_REGISTER_IDENTITY_CONFLICT: {
    layer: 'L2', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Identifier conflicts with the existing register',
    hint: 'The student code and demo identifier must refer to the same student in the register. Correct whichever value is wrong.',
  },
  L2_REGISTER_NAME_DIFFERS: {
    layer: 'L2', severity: SEVERITY.WARNING, disposition: 'JUSTIFY',
    title: 'Name differs from the existing register record',
    hint: 'The register keeps its current name; name changes need a student correction request. Justify or correct the upload.',
  },
  // L3 Duplicates ---------------------------------------------------------------------------
  L3_DUPLICATE_IN_BATCH: {
    layer: 'L3', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Student repeated in this batch',
    hint: 'Keep one row for the student in this course and year: correct the wrong row or exclude the duplicate.',
  },
  L3_ALREADY_IN_REGISTER: {
    layer: 'L3', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Student already has an active enrolment at this institution',
    hint: 'Do not upload the student again. Use the enrolment lifecycle (transfer/withdraw) for changes, or exclude this row.',
  },
  // L4 Seat ledger --------------------------------------------------------------------------
  L4_NO_ACTIVE_POLICY: {
    layer: 'L4', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'No published seat policy for this academic year',
    hint: 'A system administrator must publish a seat policy for this academic year before the batch can proceed.',
  },
  L4_NO_SEAT_LEDGER: {
    layer: 'L4', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'No seats are configured for this course and bucket',
    hint: 'Use a bucket configured for this course in the active seat policy.',
  },
  L4_BUCKET_CAPACITY_EXCEEDED: {
    layer: 'L4', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Bucket capacity would be exceeded',
    hint: 'Change the bucket only if the student is genuinely eligible for another one, or exclude the row.',
  },
  // L5 Cross-college ------------------------------------------------------------------------
  L5_ACTIVE_ENROLMENT_ELSEWHERE: {
    layer: 'L5', severity: SEVERITY.WARNING, disposition: 'JUSTIFY',
    title: 'Student appears to be actively enrolled at another institution',
    hint: 'This may be an unrecorded transfer. Justify (for example, transfer in progress); a conflict case will be opened for review after commit. This is not a finding of wrongdoing.',
  },
  // L6 Consistency --------------------------------------------------------------------------
  L6_ACADEMIC_YEAR_MISMATCH: {
    layer: 'L6', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Academic year does not match the batch',
    hint: 'Every row must use the academic year selected for the batch.',
  },
  L6_YEAR_OF_STUDY_OUT_OF_RANGE: {
    layer: 'L6', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Year of study is outside the course duration',
    hint: 'Year of study must be between 1 and the configured course duration.',
  },
  L6_ADMISSION_DATE_IN_FUTURE: {
    layer: 'L6', severity: SEVERITY.ERROR, disposition: 'NONE',
    title: 'Admission date is in the future',
    hint: 'Enter the actual admission date.',
  },
  L6_ADMISSION_DATE_OUTSIDE_WINDOW: {
    layer: 'L6', severity: SEVERITY.WARNING, disposition: 'JUSTIFY',
    title: 'Admission date is outside the configured admission window',
    hint: 'Check the date. If correct, record a justification (the window is synthetic demo configuration).',
  },
  // L7 Risk signals (never block, never a verdict) -------------------------------------------
  L7_SHARED_CONTACT: {
    layer: 'L7', severity: SEVERITY.RISK_FLAG, disposition: 'NONE',
    title: 'Contact token shared by several students',
    hint: 'Informational signal for human review only. It does not block the batch and is not evidence of wrongdoing.',
  },
  L7_LATE_ADDITION: {
    layer: 'L7', severity: SEVERITY.RISK_FLAG, disposition: 'NONE',
    title: 'Admission recorded after the admission window closed',
    hint: 'Informational signal for human review only. It does not block the batch.',
  },
  L7_ADDITIONAL_BUCKET_RATIO: {
    layer: 'L7', severity: SEVERITY.RISK_FLAG, disposition: 'NONE',
    title: 'Unusually high share of additional-bucket admissions in this batch',
    hint: 'Informational signal for human review only. It does not block the batch.',
  },
});

function getRule(ruleCode) {
  const rule = RULES[ruleCode];
  if (!rule) throw new Error(`Unknown validation rule ${ruleCode}`);
  return rule;
}

module.exports = { RULES, getRule };
