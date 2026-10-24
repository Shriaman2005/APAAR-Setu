// Synthetic demo seed (spec 10). Used by `npm run seed` and by the automated tests.
// Reference data is upserted by stable keys; scenario data is created only once (guarded by a
// marker setting), so re-running never duplicates records or double-counts seats.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  Region, Institution, Course, Organisation, SeatPolicy, SeatLedger, Student, Enrolment, User, UploadBatch, StagingRow, SystemSetting,
} = require('../models');
const { ROLES, USER_STATUS, POLICY_STATUS, BATCH_STATUS, ENROLMENT_STATE, CSV_COLUMNS } = require('../config/constants');
const { runInTransaction } = require('../utils/transaction');
const { newStudentRef, newEnrolmentRef, randomCode } = require('../utils/ids');
const { reserveSeats } = require('../services/seatLedgerService');
const { detectConflictsForStudents } = require('../services/conflictService');
const { evaluateInstitutionYear } = require('../services/riskService');
const { recordAudit } = require('../services/auditService');
const { hashPassword } = require('../services/authService');
const { contentHash } = require('../services/seatPolicyService');
const { startValidation } = require('../services/batchIngestionService');
const { markReady } = require('../services/batchWorkflowService');

const FIXTURES_DIR = path.resolve(__dirname, '../../../fixtures');
const SCENARIO_MARKER = 'demoScenarioSeeded';
const SCENARIO_VERSION = 'DEMO-SCENARIO-v1';

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

const DEMO_USERS = [
  // One account per role (spec 10 section 6)
  { email: 'operator.demo@example.test', displayName: 'Demo Operator (ABC-DEMO)', role: ROLES.COLLEGE_OPERATOR, institutionCode: 'ABC-DEMO' },
  { email: 'head.demo@example.test', displayName: 'Demo College Head (ABC-DEMO)', role: ROLES.COLLEGE_HEAD, institutionCode: 'ABC-DEMO' },
  { email: 'national.demo@example.test', displayName: 'Demo National Officer', role: ROLES.AICTE_NATIONAL_OFFICER },
  { email: 'regional.demo@example.test', displayName: 'Demo Regional Officer (REGION-DEMO)', role: ROLES.AICTE_REGIONAL_OFFICER, regionIds: ['REGION-DEMO'] },
  { email: 'admin.demo@example.test', displayName: 'Demo System Administrator', role: ROLES.AICTE_SYSTEM_ADMIN },
  { email: 'issuer.demo@example.test', displayName: 'Demo Issuer (ISSUER-DEMO)', role: ROLES.DEGREE_AWARDING_BODY, orgCode: 'ISSUER-DEMO' },
  { email: 'verifier.demo@example.test', displayName: 'Demo Verifier (VERIFIER-DEMO)', role: ROLES.VERIFIER, orgCode: 'VERIFIER-DEMO' },
  { email: 'student.demo@example.test', displayName: 'Aarav Sharma (Demo Student)', role: ROLES.STUDENT, studentCode: 'STU-001' },
  // Additions needed to demonstrate separation of duties and both sides of a conflict.
  { email: 'approver.demo@example.test', displayName: 'Demo Policy Approver (second administrator)', role: ROLES.AICTE_SYSTEM_ADMIN },
  { email: 'operator.xyz.demo@example.test', displayName: 'Demo Operator (XYZ-DEMO)', role: ROLES.COLLEGE_OPERATOR, institutionCode: 'XYZ-DEMO' },
  { email: 'head.xyz.demo@example.test', displayName: 'Demo College Head (XYZ-DEMO)', role: ROLES.COLLEGE_HEAD, institutionCode: 'XYZ-DEMO' },
];

// Random development password: letters and digits in groups, always containing both.
function generatePassword() {
  return `Demo-${randomCode(4)}-${randomCode(4)}-${crypto.randomInt(10, 99)}`;
}

async function seedReferenceData() {
  const ref = readFixture('demo_reference_data.json');
  for (const region of ref.regions) {
    await Region.updateOne({ regionId: region.regionId }, { $set: { ...region, isDemo: true } }, { upsert: true });
  }
  const institutions = new Map();
  for (const institution of ref.institutions) {
    const doc = await Institution.findOneAndUpdate(
      { institutionCode: institution.institutionCode },
      { $set: { ...institution, status: 'ACTIVE', isDemo: true } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
    institutions.set(institution.institutionCode, doc);
  }
  for (const course of ref.courses) {
    const institution = institutions.get(course.institutionCode);
    await Course.updateOne(
      { institutionId: institution._id, academicYear: ref.academicYear, courseCode: course.courseCode },
      {
        $set: {
          programName: course.programName, level: course.level, durationYears: course.durationYears, approvedIntake: course.approvedIntake,
          approvalRef: `DEMO-APPROVAL-${course.institutionCode}-${course.courseCode}-${ref.academicYear}`,
          approvalSource: 'MOCK_AICTE_APPROVAL_FIXTURE', approvalFlags: { synthetic: true }, isDemo: true,
        },
      },
      { upsert: true }
    );
  }
  for (const org of ref.organisations) {
    const affiliated = (org.affiliatedInstitutionCodes || []).map((code) => institutions.get(code)._id);
    await Organisation.updateOne(
      { orgCode: org.orgCode },
      { $set: { name: org.name, type: org.type, status: org.status, verifierCategory: org.verifierCategory, affiliatedInstitutionIds: affiliated, isDemo: true } },
      { upsert: true }
    );
  }
  // The student account (spec 10: student.demo -> STU-001) needs its student identity to exist.
  if (!(await Student.exists({ studentCode: 'STU-001' }))) {
    await Student.create({ studentRef: newStudentRef(), studentCode: 'STU-001', displayName: 'Aarav Sharma', syntheticExternalId: '111111111111', isDemo: true });
  }
  return { institutions, academicYear: ref.academicYear };
}

/**
 * @param {{ passwordFor: (email) => string|null, resetPasswords: boolean }} options
 * @returns {Promise<Array<{email, role, created, password|null}>>}
 */
async function seedUsers({ passwordFor, resetPasswords = false }) {
  const results = [];
  for (const spec of DEMO_USERS) {
    const scope = { institutionId: undefined, regionIds: spec.regionIds || [], organisationId: undefined, studentRef: undefined };
    if (spec.institutionCode) scope.institutionId = (await Institution.findOne({ institutionCode: spec.institutionCode }).lean())._id;
    if (spec.orgCode) scope.organisationId = (await Organisation.findOne({ orgCode: spec.orgCode }).lean())._id;
    if (spec.studentCode) scope.studentRef = (await Student.findOne({ studentCode: spec.studentCode }).lean()).studentRef;

    const existing = await User.findOne({ emailNormalized: spec.email }).lean();
    const setPassword = !existing || resetPasswords;
    const password = setPassword ? passwordFor(spec.email) : null;
    const update = {
      displayName: spec.displayName, role: spec.role, status: USER_STATUS.ACTIVE, isDemo: true, ...scope,
      ...(setPassword ? { passwordHash: await hashPassword(password), passwordChangedAt: new Date() } : {}),
    };
    await User.updateOne(
      { emailNormalized: spec.email },
      { $set: update, ...(setPassword && existing ? { $inc: { sessionVersion: 1 } } : {}), $unset: { oneTimeToken: 1 } },
      { upsert: true }
    );
    results.push({ email: spec.email, role: spec.role, created: !existing, password });
  }
  return results;
}

async function userObject(email) {
  const user = await User.findOne({ emailNormalized: email }).lean();
  return { id: String(user._id), role: user.role, institutionId: user.institutionId, regionIds: user.regionIds, studentRef: user.studentRef, organisationId: user.organisationId, displayName: user.displayName };
}

async function seedPolicies() {
  const v1 = readFixture('seat_policy_demo_v1.json');
  if (await SeatPolicy.exists({ academicYear: v1.academicYear })) return { created: false };
  const admin = await userObject('admin.demo@example.test');
  const approver = await userObject('approver.demo@example.test');
  const now = new Date();
  const toPolicy = (fixture) => ({
    academicYear: fixture.academicYear, version: fixture.policyVersion, sourceType: fixture.sourceType, sourceReference: fixture.sourceReference,
    notes: fixture.notes, admissionWindow: fixture.admissionWindow, scopes: fixture.scopes, authoredBy: admin.id, isDemo: true,
  });
  const published = await SeatPolicy.create({
    ...toPolicy(v1), status: POLICY_STATUS.PUBLISHED, submittedBy: admin.id, submittedAt: now, approvedBy: approver.id, approvedAt: now, effectiveAt: now,
  });
  await SeatPolicy.updateOne({ _id: published._id }, { $set: { lastValidation: { status: 'PASSED', errors: [], warnings: [], checkedAt: now, checkedBy: admin.id, contentHash: contentHash(published.toObject()) } } });
  for (const scope of v1.scopes) {
    const institution = await Institution.findOne({ institutionCode: scope.institutionCode }).lean();
    const course = await Course.findOne({ institutionId: institution._id, courseCode: scope.courseCode, academicYear: v1.academicYear }).lean();
    for (const bucket of scope.buckets) {
      await SeatLedger.updateOne(
        { courseId: course._id, academicYear: v1.academicYear, bucketCode: bucket.code },
        {
          $set: {
            institutionId: institution._id, regionId: institution.regionId, courseCode: course.courseCode, capacity: bucket.capacity,
            countsWithinIntake: bucket.countsWithinIntake, policyVersion: v1.policyVersion, sourceType: v1.sourceType, inActivePolicy: true,
          },
          $setOnInsert: { filled: 0 },
        },
        { upsert: true }
      );
    }
  }
  await recordAudit({ actor: approver, action: 'POLICY_PUBLISHED', entityType: 'SeatPolicy', entityRef: `${v1.academicYear}/${v1.policyVersion}`, reason: 'Demo seed', payload: { sourceType: v1.sourceType } });

  // DEMO-v2 waits for a DIFFERENT administrator's approval (stale-policy scenario).
  const v2 = readFixture('seat_policy_demo_v2.json');
  const pending = await SeatPolicy.create({ ...toPolicy(v2), status: POLICY_STATUS.PENDING_APPROVAL, submittedBy: admin.id, submittedAt: now });
  await SeatPolicy.updateOne({ _id: pending._id }, { $set: { lastValidation: { status: 'PASSED', errors: [], warnings: [], checkedAt: now, checkedBy: admin.id, contentHash: contentHash(pending.toObject()) } } });
  return { created: true };
}

/**
 * Commits seeded enrolments through the same seat-reservation code as a real certification,
 * inside one transaction, so the ledger always matches the enrolments.
 */
async function commitSeedEnrolments(entries, batchLabel, actor) {
  const byInstitution = new Map();
  for (const entry of entries) {
    if (!byInstitution.has(entry.institutionCode)) byInstitution.set(entry.institutionCode, []);
    byInstitution.get(entry.institutionCode).push(entry);
  }
  for (const [institutionCode, list] of byInstitution) {
    const institution = await Institution.findOne({ institutionCode }).lean();
    const batchId = `BATCH-${institutionCode}-SEED-${batchLabel}`;
    if (await UploadBatch.exists({ batchId })) continue;
    await runInTransaction(async (session) => {
      const courses = await Course.find({ institutionId: institution._id, academicYear: list[0].academicYear }).session(session).lean();
      const courseByCode = new Map(courses.map((course) => [course.courseCode, course]));
      const demand = new Map();
      for (const entry of list) demand.set(`${entry.courseCode}|${entry.bucketCode}`, (demand.get(`${entry.courseCode}|${entry.bucketCode}`) || 0) + 1);
      for (const [key, count] of demand) {
        const [courseCode, bucketCode] = key.split('|');
        await reserveSeats({ courseId: courseByCode.get(courseCode)._id, academicYear: list[0].academicYear, bucketCode, count }, session);
      }
      const enrolments = [];
      let rowNumber = 2;
      for (const entry of list) {
        let student = await Student.findOne({ studentCode: entry.studentCode }).session(session).lean();
        if (!student) {
          [student] = await Student.create([{
            studentRef: newStudentRef(), studentCode: entry.studentCode, displayName: entry.displayName,
            syntheticExternalId: entry.syntheticExternalId, externalLinkStatus: 'MATCHED', isDemo: true,
          }], { session });
        }
        const course = courseByCode.get(entry.courseCode);
        enrolments.push({
          enrolmentRef: newEnrolmentRef(), studentRef: student.studentRef, studentId: student._id, institutionId: institution._id, regionId: institution.regionId,
          courseId: course._id, courseCode: course.courseCode, academicYear: entry.academicYear, yearOfStudy: entry.yearOfStudy, bucketCode: entry.bucketCode,
          state: entry.state || ENROLMENT_STATE.CONFIRMED, seatHeld: true, admittedOn: entry.admittedOn, contactToken: entry.contactToken,
          identityStatusAtCommit: 'MATCHED', sourceBatchId: batchId, sourceRowNumber: rowNumber, isDemo: true,
          history: [{ fromState: null, toState: entry.state || ENROLMENT_STATE.CONFIRMED, seatEffect: 'RESERVE', reason: `Synthetic demo seed (${batchId})`, actorRole: 'SYSTEM', at: new Date(), sourceBatchId: batchId }],
        });
        rowNumber += 1;
      }
      await Enrolment.insertMany(enrolments, { session });
      await UploadBatch.create([{
        batchId, institutionId: institution._id, regionId: institution.regionId, academicYear: list[0].academicYear, sourceFileName: `${batchLabel.toLowerCase()}-seed.json`,
        fileHash: crypto.createHash('sha256').update(batchId).digest('hex'), fileSizeBytes: 0, status: BATCH_STATUS.COMMITTED, createdBy: actor.id,
        counts: { totalRows: list.length, includedRows: list.length, validRows: list.length },
        commitSummary: { committedRows: list.length, enrolmentsCreated: list.length, studentsCreated: list.length, committedAt: new Date(), policyVersion: 'DEMO-v1' },
        statusHistory: [{ from: null, to: BATCH_STATUS.COMMITTED, at: new Date(), reason: 'Synthetic demo seed (not a real upload)' }],
      }], { session });
      await recordAudit({
        actor: 'system', action: 'SEED_ENROLMENTS_CREATED', entityType: 'UploadBatch', entityRef: batchId, institutionId: institution._id,
        regionIds: [institution.regionId], reason: 'Synthetic demo seed', payload: { enrolments: list.length },
      }, { session });
    });
  }
}

async function seedStaleBatch() {
  const fixture = readFixture('stale_policy_batch.json');
  const operator = await userObject('operator.demo@example.test');
  const institution = await Institution.findOne({ institutionCode: fixture.institutionCode }).lean();
  const batchId = `BATCH-${fixture.institutionCode}-SEED-STALE`;
  if (await UploadBatch.exists({ batchId })) return;
  await UploadBatch.create({
    batchId, institutionId: institution._id, regionId: institution.regionId, academicYear: fixture.academicYear, sourceFileName: fixture.sourceFileName,
    fileHash: crypto.createHash('sha256').update(batchId).digest('hex'), fileSizeBytes: 0, status: BATCH_STATUS.UPLOADED, createdBy: operator.id,
    counts: { totalRows: fixture.rows.length, includedRows: fixture.rows.length },
    statusHistory: [{ from: null, to: BATCH_STATUS.UPLOADED, at: new Date(), by: operator.id, reason: 'Synthetic stale-policy fixture' }],
  });
  await StagingRow.insertMany(fixture.rows.map((row, index) => {
    const fields = {};
    for (const column of CSV_COLUMNS) fields[column] = String(row[column] ?? '');
    return { batchId, institutionId: institution._id, rowNumber: index + 2, rawSafeFields: fields, fields };
  }));
  // Real validation pipeline run under the currently published policy (DEMO-v1)...
  await startValidation(batchId, operator, { awaitCompletion: true, fromStatuses: [BATCH_STATUS.UPLOADED] });
  // ...then handed to the college head, exactly as the operator would.
  await markReady(operator, batchId, 'Synthetic stale-policy fixture: validated under DEMO-v1.');
}

async function seedScenario() {
  if (await SystemSetting.exists({ key: SCENARIO_MARKER })) return { created: false };
  const system = await userObject('admin.demo@example.test');
  const conflictFixture = readFixture('cross_college_conflict.json');
  const riskFixture = readFixture('shared_contact_risk.json');
  const background = readFixture('background_enrolments.json');

  await commitSeedEnrolments(conflictFixture.enrolments.map((e) => ({ ...e, ...conflictFixture.student, academicYear: conflictFixture.academicYear })), 'CONFLICT', system);
  await commitSeedEnrolments(riskFixture.students.map((s) => ({
    ...s, institutionCode: riskFixture.institutionCode, courseCode: riskFixture.courseCode, bucketCode: riskFixture.bucketCode,
    contactToken: riskFixture.contactToken, yearOfStudy: 1, academicYear: riskFixture.academicYear,
  })), 'RISK', system);
  await commitSeedEnrolments(background.enrolments.map((e) => ({ ...e, academicYear: background.academicYear })), 'BACKGROUND', system);

  const stu005 = await Student.findOne({ studentCode: conflictFixture.student.studentCode }).lean();
  await runInTransaction((session) => detectConflictsForStudents([stu005.studentRef], conflictFixture.academicYear, { session, actor: 'system', detectedBy: 'SEED_DETECTOR' }));

  const pqr = await Institution.findOne({ institutionCode: riskFixture.institutionCode }).lean();
  await evaluateInstitutionYear(pqr._id, riskFixture.academicYear, { actor: 'system' });

  await seedStaleBatch();
  await SystemSetting.updateOne({ key: SCENARIO_MARKER }, { $set: { value: SCENARIO_VERSION } }, { upsert: true });
  return { created: true };
}

/**
 * Full seed. `passwordFor(email)` returns the password to set for a new (or reset) account.
 */
async function runDemoSeed({ passwordFor = () => generatePassword(), resetPasswords = false } = {}) {
  await seedReferenceData();
  const users = await seedUsers({ passwordFor, resetPasswords });
  const policies = await seedPolicies();
  const scenario = await seedScenario();
  return { users, policiesCreated: policies.created, scenarioCreated: scenario.created };
}

module.exports = { runDemoSeed, DEMO_USERS, generatePassword, readFixture, FIXTURES_DIR, SCENARIO_MARKER };
