// Shared enums and transition tables.
// Keeping them in one file means the database, services and tests all agree on the same values
// (spec 06 section 4: "Use one agreed enum and transition table").

const ROLES = Object.freeze({
  COLLEGE_OPERATOR: 'COLLEGE_OPERATOR',
  COLLEGE_HEAD: 'COLLEGE_HEAD',
  AICTE_NATIONAL_OFFICER: 'AICTE_NATIONAL_OFFICER',
  AICTE_REGIONAL_OFFICER: 'AICTE_REGIONAL_OFFICER',
  AICTE_SYSTEM_ADMIN: 'AICTE_SYSTEM_ADMIN',
  DEGREE_AWARDING_BODY: 'DEGREE_AWARDING_BODY',
  VERIFIER: 'VERIFIER',
  STUDENT: 'STUDENT',
});
const ALL_ROLES = Object.values(ROLES);
const COLLEGE_ROLES = [ROLES.COLLEGE_OPERATOR, ROLES.COLLEGE_HEAD];
const OFFICER_ROLES = [ROLES.AICTE_NATIONAL_OFFICER, ROLES.AICTE_REGIONAL_OFFICER];

const USER_STATUS = Object.freeze({
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
});

// ---------------------------------------------------------------------------
// Upload batch lifecycle
// ---------------------------------------------------------------------------
const BATCH_STATUS = Object.freeze({
  UPLOADED: 'UPLOADED', // rows staged, first validation not finished yet
  VALIDATING: 'VALIDATING', // validation job running
  NEEDS_CORRECTION: 'NEEDS_CORRECTION', // blocking errors, blocking pending checks or stale rows
  VALIDATED: 'VALIDATED', // no blocking errors; warnings may still need justification
  READY_FOR_REVIEW: 'READY_FOR_REVIEW', // operator handed over to the college head
  RETURNED_FOR_CORRECTION: 'RETURNED_FOR_CORRECTION', // head sent it back with a reason
  COMMITTING: 'COMMITTING', // head certified; commit transaction in progress
  COMMITTED: 'COMMITTED', // official records written (terminal)
  COMMIT_FAILED: 'COMMIT_FAILED', // commit transaction rolled back for a technical reason
  DISCARDED: 'DISCARDED', // operator abandoned the staged upload (terminal)
});

const BATCH_TRANSITIONS = Object.freeze({
  UPLOADED: ['VALIDATING', 'DISCARDED'],
  VALIDATING: ['NEEDS_CORRECTION', 'VALIDATED'],
  NEEDS_CORRECTION: ['VALIDATING', 'DISCARDED'],
  VALIDATED: ['VALIDATING', 'NEEDS_CORRECTION', 'READY_FOR_REVIEW', 'DISCARDED'],
  READY_FOR_REVIEW: ['RETURNED_FOR_CORRECTION', 'COMMITTING', 'NEEDS_CORRECTION'],
  RETURNED_FOR_CORRECTION: ['VALIDATING', 'NEEDS_CORRECTION', 'DISCARDED'],
  COMMITTING: ['COMMITTED', 'NEEDS_CORRECTION', 'COMMIT_FAILED'],
  COMMIT_FAILED: ['COMMITTING', 'RETURNED_FOR_CORRECTION', 'VALIDATING', 'NEEDS_CORRECTION', 'DISCARDED'],
  COMMITTED: [],
  DISCARDED: [],
});

// Statuses in which the operator may edit staging rows.
const BATCH_EDITABLE_STATUSES = ['NEEDS_CORRECTION', 'VALIDATED', 'RETURNED_FOR_CORRECTION', 'COMMIT_FAILED'];
// Statuses from which a (re)validation run may start.
const BATCH_REVALIDATABLE_STATUSES = ['UPLOADED', 'NEEDS_CORRECTION', 'VALIDATED', 'RETURNED_FOR_CORRECTION', 'COMMIT_FAILED'];
// Statuses that still count as "open" for the duplicate-file check.
const BATCH_OPEN_STATUSES = [
  'UPLOADED', 'VALIDATING', 'NEEDS_CORRECTION', 'VALIDATED', 'READY_FOR_REVIEW',
  'RETURNED_FOR_CORRECTION', 'COMMITTING', 'COMMIT_FAILED',
];

function canTransitionBatch(from, to) {
  return (BATCH_TRANSITIONS[from] || []).includes(to);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const SEVERITY = Object.freeze({
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  PENDING: 'PENDING',
  INFO: 'INFO',
  RISK_FLAG: 'RISK_FLAG',
});

const ISSUE_STATUS = Object.freeze({
  OPEN: 'OPEN', // detected and not yet handled
  JUSTIFIED: 'JUSTIFIED', // operator (maker) recorded a justification
  ACCEPTED: 'ACCEPTED', // college head (checker) accepted the disposition
  RESOLVED: 'RESOLVED', // no longer detected after correction and revalidation
  SUPERSEDED: 'SUPERSEDED', // replaced by a newer validation run of a changed row
});

const IDENTITY_CHECK_STATUS = Object.freeze({
  NOT_CHECKED: 'NOT_CHECKED',
  FORMAT_INVALID: 'FORMAT_INVALID',
  MATCHED: 'MATCHED',
  NAME_MISMATCH: 'NAME_MISMATCH',
  NOT_FOUND: 'NOT_FOUND',
  PENDING: 'PENDING',
});

// The editable CSV columns. Internal fields (row number, batch, institution,
// validation results, original upload snapshot) can never be edited.
const CSV_COLUMNS = Object.freeze([
  'studentCode',
  'studentName',
  'courseCode',
  'academicYear',
  'bucketCode',
  'externalIdDemo',
  'contactToken',
  'yearOfStudy',
  'admittedOn',
]);
const EDITABLE_ROW_FIELDS = CSV_COLUMNS;

// ---------------------------------------------------------------------------
// Seat policy and ledger
// ---------------------------------------------------------------------------
const POLICY_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  PUBLISHED: 'PUBLISHED',
  SUPERSEDED: 'SUPERSEDED',
});

// ---------------------------------------------------------------------------
// Enrolment lifecycle (spec 07 section 7)
// STAGED is represented by staging rows, never by an official Enrolment document.
// ---------------------------------------------------------------------------
const ENROLMENT_STATE = Object.freeze({
  PROVISIONAL: 'PROVISIONAL',
  CONFIRMED: 'CONFIRMED',
  WITHDRAWN: 'WITHDRAWN',
  TRANSFERRED: 'TRANSFERRED',
  COMPLETED: 'COMPLETED',
  DROPPED: 'DROPPED',
});

// States that occupy a seat in the ledger. Leaving these states releases the seat exactly once.
const SEAT_OCCUPYING_STATES = ['PROVISIONAL', 'CONFIRMED'];

// One transition table with explicit seat effects. Anything not listed is rejected.
const ENROLMENT_TRANSITIONS = Object.freeze({
  PROVISIONAL: {
    CONFIRMED: { seatEffect: 'NONE' },
    WITHDRAWN: { seatEffect: 'RELEASE' },
    TRANSFERRED: { seatEffect: 'RELEASE' },
    DROPPED: { seatEffect: 'RELEASE' },
  },
  CONFIRMED: {
    WITHDRAWN: { seatEffect: 'RELEASE' },
    TRANSFERRED: { seatEffect: 'RELEASE' },
    COMPLETED: { seatEffect: 'RELEASE' },
    DROPPED: { seatEffect: 'RELEASE' },
  },
  WITHDRAWN: {},
  TRANSFERRED: {},
  COMPLETED: {},
  DROPPED: {},
});

function getEnrolmentTransition(from, to) {
  return (ENROLMENT_TRANSITIONS[from] || {})[to] || null;
}

// ---------------------------------------------------------------------------
// Conflicts and risk
// ---------------------------------------------------------------------------
const CONFLICT_STATUS = Object.freeze({
  OPEN: 'OPEN',
  AWAITING_REVIEW: 'AWAITING_REVIEW', // a justification was submitted and needs an AICTE officer
  RESOLVED: 'RESOLVED',
});
const CONFLICT_TYPE = Object.freeze({
  MULTIPLE_ACTIVE_ENROLMENTS: 'MULTIPLE_ACTIVE_ENROLMENTS',
});

const RISK_CASE_STATUS = Object.freeze({
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  REVIEWED: 'REVIEWED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  ESCALATED: 'ESCALATED',
});

// ---------------------------------------------------------------------------
// Consent, verification and credentials
// ---------------------------------------------------------------------------
const CONSENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
});

const CREDENTIAL_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', REVOKED: 'REVOKED' });

const ORG_TYPES = Object.freeze({ ISSUER: 'ISSUER', VERIFIER: 'VERIFIER' });
const ORG_STATUS = Object.freeze({ PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' });

// Label shown wherever synthetic configuration is displayed (spec 07 section 5).
const SYNTHETIC_SOURCE_TYPE = 'SYNTHETIC_DEMO_CONFIG';

module.exports = {
  ROLES,
  ALL_ROLES,
  COLLEGE_ROLES,
  OFFICER_ROLES,
  USER_STATUS,
  BATCH_STATUS,
  BATCH_TRANSITIONS,
  BATCH_EDITABLE_STATUSES,
  BATCH_REVALIDATABLE_STATUSES,
  BATCH_OPEN_STATUSES,
  canTransitionBatch,
  SEVERITY,
  ISSUE_STATUS,
  IDENTITY_CHECK_STATUS,
  CSV_COLUMNS,
  EDITABLE_ROW_FIELDS,
  POLICY_STATUS,
  ENROLMENT_STATE,
  SEAT_OCCUPYING_STATES,
  ENROLMENT_TRANSITIONS,
  getEnrolmentTransition,
  CONFLICT_STATUS,
  CONFLICT_TYPE,
  RISK_CASE_STATUS,
  CONSENT_STATUS,
  CREDENTIAL_STATUS,
  ORG_TYPES,
  ORG_STATUS,
  SYNTHETIC_SOURCE_TYPE,
};
