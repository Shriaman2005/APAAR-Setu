// Seven validation layers: at least one failing and one passing case each (spec 07 section 9),
// plus ERROR / WARNING / PENDING / RISK_FLAG semantics.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture, currentIssues } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { StagingRow } = require('../src/models');
const { runL4 } = require('../src/services/validation/l4SeatLedger');
const { makeIssue, handlingFor } = require('../src/services/validation/issueFactory');
const { RULES } = require('../src/services/validation/ruleCatalog');

const HEADER = 'studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn';
let ctx;
let operator;
let admin;

before(async () => {
  ctx = await setupTestApp();
  operator = await loginAs(ctx.app, 'operator.demo@example.test');
  admin = await loginAs(ctx.app, 'admin.demo@example.test');
});
after(async () => { if (ctx) await ctx.cleanup(); });

async function batchStatus(batchId) {
  return (await operator.get(`/api/batches/${batchId}`)).body;
}

describe('clean batch (passing case for every layer)', () => {
  test('clean fixture produces no issues and is VALIDATED', async () => {
    const { batchId } = await uploadFixture(operator, 'clean_batch.csv');
    const detail = await batchStatus(batchId);
    assert.equal(detail.batch.status, 'VALIDATED');
    assert.equal(detail.batch.counts.openErrors, 0);
    assert.equal(detail.batch.counts.validRows, 4);
    assert.equal((await currentIssues(operator, batchId)).length, 0);
    const rows = await StagingRow.find({ batchId }).lean();
    assert.ok(rows.every((r) => r.identityCheck.status === 'MATCHED' && r.validationStatus === 'VALID'));
    assert.equal(detail.batch.validatedPolicyVersion, 'DEMO-v1');
  });
});

describe('L1 schema', () => {
  test('missing courseCode and studentName are row/field-specific ERRORs that block', async () => {
    const { batchId } = await uploadFixture(operator, 'missing_required_field.csv');
    const issues = await currentIssues(operator, batchId);
    const required = issues.filter((i) => i.ruleCode === 'L1_REQUIRED_FIELD');
    assert.deepEqual(required.map((i) => [i.rowNumber, i.field]).sort(), [[2, 'courseCode'], [3, 'studentName']]);
    assert.ok(required.every((i) => i.severity === 'ERROR' && i.blocking));
    assert.match(required[0].message, /^Row \d+: /);
    const detail = await batchStatus(batchId);
    assert.equal(detail.batch.status, 'NEEDS_CORRECTION');
    assert.equal(detail.readiness.canMarkReady, false);
  });

  test('bad formats are reported (date, year of study, phone-like contact token)', async () => {
    const content = `${HEADER}\nSTU-401,Nisha Pillai,CSE,2026-27,REGULAR,333333333341,9876543210,9,2026-02-30\n`;
    const { batchId } = await uploadFixture(operator, 'formats.csv', { content });
    const codes = (await currentIssues(operator, batchId)).filter((i) => i.layer === 'L1').map((i) => i.field).sort();
    assert.deepEqual(codes, ['admittedOn', 'contactToken', 'yearOfStudy']);
  });
});

describe('L2 external identity (mock)', () => {
  test('11-digit demo identifier is a format ERROR with no registry lookup', async () => {
    const { batchId } = await uploadFixture(operator, 'bad_mock_external_id.csv');
    const issues = await currentIssues(operator, batchId);
    const format = issues.find((i) => i.ruleCode === 'L2_EXTERNAL_ID_FORMAT');
    assert.equal(format.severity, 'ERROR');
    assert.match(format.message, /format check only/);
    const row = await StagingRow.findOne({ batchId }).lean();
    assert.equal(row.identityCheck.status, 'FORMAT_INVALID');
  });

  test('name mismatch against the mock record is a WARNING that needs a disposition', async () => {
    const { batchId } = await uploadFixture(operator, 'warnings_demo.csv');
    const mismatch = (await currentIssues(operator, batchId)).find((i) => i.ruleCode === 'L2_MOCK_NAME_MISMATCH');
    assert.equal(mismatch.severity, 'WARNING');
    assert.equal(mismatch.blocking, false);
    assert.equal(mismatch.dispositionRequired, true);
    assert.equal((await batchStatus(batchId)).batch.status, 'VALIDATED', 'warnings alone do not block validation');
  });

  test('registry pending is PENDING (never verified) and blocks under the default policy', async () => {
    const { batchId } = await uploadFixture(operator, 'registry_pending.csv');
    const pending = (await currentIssues(operator, batchId)).filter((i) => i.ruleCode === 'L2_IDENTITY_CHECK_PENDING');
    assert.equal(pending.length, 2);
    assert.ok(pending.every((i) => i.severity === 'PENDING' && i.blocking));
    const rows = await StagingRow.find({ batchId }).lean();
    assert.ok(rows.every((r) => r.identityCheck.status === 'PENDING'));
    const detail = await batchStatus(batchId);
    assert.equal(detail.batch.status, 'NEEDS_CORRECTION');
    assert.ok(detail.readiness.markReadyBlockers.some((b) => b.code === 'PENDING_CHECKS'));
  });

  test('mock service UNAVAILABLE setting makes every identity check PENDING', async () => {
    const set = await admin.put('/api/admin/settings', { changes: { mockIdentityServiceMode: 'UNAVAILABLE' }, reason: 'Simulate outage for a synthetic test' });
    assert.equal(set.status, 200);
    const content = `${HEADER}\nSTU-402,Varun Rao,CSE,2026-27,REGULAR,333333333342,PHONE-DEMO-V,1,2026-08-02\n`;
    const { batchId } = await uploadFixture(operator, 'outage.csv', { content });
    const pending = (await currentIssues(operator, batchId)).find((i) => i.ruleCode === 'L2_IDENTITY_CHECK_PENDING');
    assert.equal(pending.evidence.reason, 'SERVICE_UNAVAILABLE');
    await admin.put('/api/admin/settings', { changes: { mockIdentityServiceMode: 'AVAILABLE' }, reason: 'Restore after synthetic outage test' });
    const retry = await operator.post(`/api/batches/${batchId}/revalidate`);
    assert.equal(retry.status, 202);
    assert.equal((await currentIssues(operator, batchId)).filter((i) => i.ruleCode === 'L2_IDENTITY_CHECK_PENDING').length, 0, 'retry completes the check');
  });

  test('identifier already linked to another student in the register is an ERROR', async () => {
    const content = `${HEADER}\nSTU-403,Rohan Mehta,CSE,2026-27,REGULAR,666666666605,PHONE-DEMO-U,1,2026-08-02\n`;
    const { batchId } = await uploadFixture(operator, 'identity-conflict.csv', { content });
    assert.ok((await currentIssues(operator, batchId)).some((i) => i.ruleCode === 'L2_REGISTER_IDENTITY_CONFLICT'));
  });
});

describe('L3 duplicates', () => {
  test('duplicate rows each reference the other row number and nothing is merged', async () => {
    const { batchId } = await uploadFixture(operator, 'duplicate_in_batch.csv');
    const duplicates = (await currentIssues(operator, batchId)).filter((i) => i.ruleCode === 'L3_DUPLICATE_IN_BATCH');
    assert.deepEqual(duplicates.map((i) => i.rowNumber).sort(), [2, 4]);
    assert.deepEqual(duplicates.find((i) => i.rowNumber === 2).evidence.relatedRows, [4]);
    assert.deepEqual(duplicates.find((i) => i.rowNumber === 4).evidence.relatedRows, [2]);
    assert.equal(await StagingRow.countDocuments({ batchId }), 3, 'rows are not merged or deleted');
  });

  test('student already active at this institution is an ERROR', async () => {
    const content = `${HEADER}\nSTU-005,Rohan Mehta,CSE,2026-27,REGULAR,666666666605,PHONE-DEMO-R,1,2026-08-05\n`;
    const { batchId } = await uploadFixture(operator, 'again.csv', { content });
    assert.ok((await currentIssues(operator, batchId)).some((i) => i.ruleCode === 'L3_ALREADY_IN_REGISTER'));
  });
});

describe('L4 seat ledger', () => {
  test('NRI capacity 3 rejects the fourth reservation only', async () => {
    const { batchId } = await uploadFixture(operator, 'bucket_overflow.csv');
    const overflow = (await currentIssues(operator, batchId)).filter((i) => i.ruleCode === 'L4_BUCKET_CAPACITY_EXCEEDED');
    assert.equal(overflow.length, 1);
    assert.equal(overflow[0].rowNumber, 5);
    assert.equal(overflow[0].evidence.capacity, 3);
    assert.equal(overflow[0].evidence.sourceType, 'SYNTHETIC_DEMO_CONFIG');
  });

  test('configured additional buckets do not trigger a total-only overflow', () => {
    // Pure-function test: REGULAR+NRI already full (60 = approved intake), TFW and INTERNATIONAL add 6 more.
    const ledgers = new Map([
      ['CSE|REGULAR', { capacity: 57, filled: 57, inActivePolicy: true, countsWithinIntake: true }],
      ['CSE|NRI', { capacity: 3, filled: 3, inActivePolicy: true, countsWithinIntake: true }],
      ['CSE|TFW', { capacity: 3, filled: 0, inActivePolicy: true, countsWithinIntake: false }],
      ['CSE|INTERNATIONAL', { capacity: 3, filled: 0, inActivePolicy: true, countsWithinIntake: false }],
    ]);
    const rows = [];
    const rowInfo = new Map();
    ['TFW', 'TFW', 'TFW', 'INTERNATIONAL', 'INTERNATIONAL', 'INTERNATIONAL'].forEach((bucketCode, index) => {
      rows.push({ rowNumber: index + 2, fields: { courseCode: 'CSE', bucketCode } });
      rowInfo.set(index + 2, { valid: { courseCode: true, bucketCode: true } });
    });
    const issues = runL4({ policy: { version: 'DEMO-v1' }, batch: { academicYear: '2026-27' }, rows, rowInfo, ledgersByKey: ledgers, pendingPolicy: 'BLOCK_UNTIL_RESOLVED' });
    assert.equal(issues.length, 0, 'total exceeds intake (66 > 60) but every bucket is within its own capacity');
  });

  test('unknown bucket for the course is reported', async () => {
    const content = `${HEADER}\nSTU-404,Riya Bhatt,CSE,2026-27,MANAGEMENT,888888888803,PHONE-DEMO-T,1,2026-08-02\n`;
    const { batchId } = await uploadFixture(operator, 'bucket.csv', { content });
    assert.ok((await currentIssues(operator, batchId)).some((i) => i.ruleCode === 'L1_INVALID_VALUE' && i.field === 'bucketCode'));
  });
});

describe('L5 cross-college', () => {
  test('student active at another institution gets a WARNING (not a fraud verdict)', async () => {
    const { batchId } = await uploadFixture(operator, 'warnings_demo.csv', { content: `${HEADER}\nSTU-021,Ishita Rao,CSE,2026-27,REGULAR,666666666621,PHONE-DEMO-X1,1,2026-08-14\n` });
    const warning = (await currentIssues(operator, batchId)).find((i) => i.ruleCode === 'L5_ACTIVE_ENROLMENT_ELSEWHERE');
    assert.equal(warning.severity, 'WARNING');
    assert.deepEqual(warning.evidence.otherInstitutions, ['XYZ Engineering College (Demo)']);
    assert.match(warning.message, /not a finding of wrongdoing/);
  });
});

describe('L6 consistency', () => {
  test('academic year mismatch, out-of-range year of study and future date are ERRORs', async () => {
    const content = `${HEADER}\nSTU-405,Aditi Rao,CSE,2027-28,REGULAR,333333333301,PHONE-DEMO-S,5,2099-01-01\n`;
    const { batchId } = await uploadFixture(operator, 'l6.csv', { content });
    const l6 = (await currentIssues(operator, batchId)).filter((i) => i.layer === 'L6').map((i) => i.ruleCode).sort();
    assert.deepEqual(l6, ['L6_ACADEMIC_YEAR_MISMATCH', 'L6_ADMISSION_DATE_IN_FUTURE', 'L6_YEAR_OF_STUDY_OUT_OF_RANGE']);
  });

  test('admission outside the synthetic window is a WARNING', async () => {
    const content = `${HEADER}\nSTU-406,Gaurav Iyer,CSE,2026-27,REGULAR,333333333332,PHONE-DEMO-Q2,1,2026-06-15\n`;
    const { batchId } = await uploadFixture(operator, 'window.csv', { content });
    const warning = (await currentIssues(operator, batchId)).find((i) => i.ruleCode === 'L6_ADMISSION_DATE_OUTSIDE_WINDOW');
    assert.equal(warning.severity, 'WARNING');
  });
});

describe('L7 risk signals', () => {
  test('shared contact token raises RISK_FLAGs that never block', async () => {
    const rows = ['STU-501,Tanvi Shah,333333333311', 'STU-502,Aryan Kapoor,333333333312', 'STU-503,Diya Menon,333333333313']
      .map((r) => `${r.split(',')[0]},${r.split(',')[1]},CSE,2026-27,REGULAR,${r.split(',')[2]},PHONE-DEMO-SAME,1,2026-08-02`).join('\n');
    const { batchId } = await uploadFixture(operator, 'shared.csv', { content: `${HEADER}\n${rows}\n` });
    const flags = (await currentIssues(operator, batchId)).filter((i) => i.ruleCode === 'L7_SHARED_CONTACT');
    assert.equal(flags.length, 3);
    assert.ok(flags.every((f) => f.severity === 'RISK_FLAG' && !f.blocking && !f.dispositionRequired));
    const detail = await batchStatus(batchId);
    assert.equal(detail.batch.status, 'VALIDATED');
    assert.equal(detail.readiness.canMarkReady, true, 'risk flags alone do not block');
  });

  test('late addition produces a risk flag alongside the L6 warning', async () => {
    const { batchId } = await uploadFixture(operator, 'late.csv', { content: `${HEADER}\nSTU-332,Gaurav Iyer,CSE,2026-27,REGULAR,333333333332,PHONE-DEMO-Q,1,2026-10-05\n` });
    const codes = (await currentIssues(operator, batchId)).map((i) => i.ruleCode);
    assert.ok(codes.includes('L7_LATE_ADDITION'));
    assert.ok(codes.includes('L6_ADMISSION_DATE_OUTSIDE_WINDOW'));
  });
});

describe('severity handling rules', () => {
  test('every catalogue rule maps to the documented handling', () => {
    for (const [code, rule] of Object.entries(RULES)) {
      const handling = handlingFor(rule, 'BLOCK_UNTIL_RESOLVED');
      if (rule.severity === 'ERROR') assert.deepEqual(handling, { blocking: true, dispositionRequired: false }, code);
      if (rule.severity === 'RISK_FLAG') assert.deepEqual(handling, { blocking: false, dispositionRequired: false }, code);
      if (rule.severity === 'WARNING') assert.equal(handling.blocking, false, code);
    }
    assert.deepEqual(handlingFor(RULES.L2_IDENTITY_CHECK_PENDING, 'ALLOW_WITH_HEAD_DISPOSITION'), { blocking: false, dispositionRequired: true });
  });

  test('fingerprint is stable for the same problem', () => {
    const a = makeIssue('L1_REQUIRED_FIELD', { rowNumber: 2, field: 'courseCode', message: 'x' }, { pendingPolicy: 'BLOCK_UNTIL_RESOLVED' });
    const b = makeIssue('L1_REQUIRED_FIELD', { rowNumber: 2, field: 'courseCode', message: 'y' }, { pendingPolicy: 'BLOCK_UNTIL_RESOLVED' });
    assert.equal(a.fingerprint, b.fingerprint);
  });

  test('async validation mode returns VALIDATING first and finishes in the background', async () => {
    const asyncApp = createApp({ ...ctx.config, validationMode: 'async' });
    const asyncOperator = await loginAs(asyncApp, 'operator.demo@example.test');
    const content = `${HEADER}\nSTU-407,Kunal Desai,CSE,2026-27,REGULAR,333333333314,PHONE-DEMO-AS,1,2026-08-02\n`;
    const res = await asyncOperator.upload('async.csv', { content });
    assert.equal(res.status, 202);
    assert.equal(res.body.status, 'VALIDATING');
    let status = 'VALIDATING';
    for (let i = 0; i < 50 && status === 'VALIDATING'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await asyncOperator.get(`/api/batches/${res.body.batchId}`)).body.batch.status;
    }
    assert.equal(status, 'VALIDATED');
  });
});
