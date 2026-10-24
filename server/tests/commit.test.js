// Certification and commit: transactions, idempotency, concurrency, rollback and stale policy
// (spec 07 sections 6 and 9, spec 08 seat-transaction and batch-workflow groups).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture, justifyAllAndCertify } = require('./helpers/testApp');
const { Enrolment, SeatLedger, Student, UploadBatch, AuditLog, Course, Institution } = require('../src/models');
const { testHooks } = require('../src/services/commitService');
const { reconcileLedgers } = require('../src/services/seatLedgerService');

const HEADER = 'studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn';
let ctx;
let operator;
let head;

async function ledgerFor(courseCode, bucketCode) {
  const abc = await Institution.findOne({ institutionCode: 'ABC-DEMO' }).lean();
  const course = await Course.findOne({ institutionId: abc._id, courseCode }).lean();
  return SeatLedger.findOne({ courseId: course._id, academicYear: '2026-27', bucketCode }).lean();
}

async function readyBatch(fileName, content) {
  const { batchId } = await uploadFixture(operator, fileName, content ? { content } : undefined);
  const ready = await operator.post(`/api/batches/${batchId}/mark-ready`, {});
  assert.equal(ready.status, 200, JSON.stringify(ready.body));
  return batchId;
}

before(async () => {
  ctx = await setupTestApp();
  operator = await loginAs(ctx.app, 'operator.demo@example.test');
  head = await loginAs(ctx.app, 'head.demo@example.test');
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('certification preconditions', () => {
  test('a batch with blocking errors cannot be marked ready or certified', async () => {
    const { batchId } = await uploadFixture(operator, 'bucket_overflow.csv');
    assert.equal((await operator.post(`/api/batches/${batchId}/mark-ready`, {})).status, 409);
    const certify = await head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId });
    assert.equal(certify.status, 409);
    assert.equal(certify.body.error.code, 'CERTIFICATION_BLOCKED');
    assert.equal(await Enrolment.countDocuments({ sourceBatchId: batchId }), 0);
    const nri = await ledgerFor('CSE', 'NRI');
    assert.ok(nri.filled <= nri.capacity, 'counter never above capacity');
  });

  test('declaration and typed confirmation are required', async () => {
    const batchId = await readyBatch('decl.csv', `${HEADER}\nSTU-701,Chetan Rao,CSE,2026-27,REGULAR,100000000003,PHONE-DEMO-D1,1,2026-08-02\n`);
    assert.equal((await head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: false, confirmBatchId: batchId })).body.error.code, 'DECLARATION_REQUIRED');
    assert.equal((await head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: 'WRONG' })).body.error.code, 'CONFIRMATION_MISMATCH');
    const ok = await head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  test('head of another institution cannot certify', async () => {
    const batchId = await readyBatch('other-head.csv', `${HEADER}\nSTU-702,Deepa Nair,CSE,2026-27,REGULAR,100000000004,PHONE-DEMO-D2,1,2026-08-02\n`);
    const headXyz = await loginAs(ctx.app, 'head.xyz.demo@example.test');
    const res = await headXyz.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId });
    assert.equal(res.status, 404);
    assert.equal((await UploadBatch.findOne({ batchId }).lean()).status, 'READY_FOR_REVIEW');
  });
});

describe('successful commit', () => {
  test('commit writes enrolments, seats, history and audit consistently', async () => {
    const regularBefore = await ledgerFor('CSE', 'REGULAR');
    const { batchId } = await uploadFixture(operator, 'clean_batch.csv');
    const res = await justifyAllAndCertify({ operator, head, batchId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.commitSummary.committedRows, 4);
    const enrolments = await Enrolment.find({ sourceBatchId: batchId }).lean();
    assert.equal(enrolments.length, 4);
    assert.ok(enrolments.every((e) => e.state === 'CONFIRMED' && e.seatHeld && e.history.length === 1));
    assert.equal((await ledgerFor('CSE', 'REGULAR')).filled, regularBefore.filled + 4);
    const stu001 = await Student.findOne({ studentCode: 'STU-001' }).lean();
    assert.equal(stu001.externalLinkStatus, 'MATCHED', 'existing student linked, not duplicated');
    assert.equal(await Student.countDocuments({ studentCode: 'STU-001' }), 1);
    assert.ok(await AuditLog.exists({ action: 'BATCH_CERTIFIED_COMMITTED', entityRef: batchId }));
    assert.equal((await reconcileLedgers()).consistent, true);
  });

  test('repeating certification is idempotent (no double commit)', async () => {
    const batchId = await readyBatch('idem.csv', `${HEADER}\nSTU-703,Eshan Gill,CSE,2026-27,REGULAR,100000000005,PHONE-DEMO-D3,1,2026-08-02\n`);
    const first = await head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId });
    const second = await head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.idempotentReplay, true);
    assert.equal(await Enrolment.countDocuments({ sourceBatchId: batchId }), 1);
  });

  test('concurrent certification of the same batch commits exactly once', async () => {
    const batchId = await readyBatch('race.csv', `${HEADER}\nSTU-704,Fatima Shaikh,CSE,2026-27,REGULAR,100000000006,PHONE-DEMO-D4,1,2026-08-02\n`);
    const results = await Promise.all([1, 2, 3].map(() => head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId })));
    assert.ok(results.some((r) => r.status === 200 && r.body.idempotentReplay === false));
    assert.ok(results.every((r) => r.status === 200 || r.status === 409));
    assert.equal(await Enrolment.countDocuments({ sourceBatchId: batchId }), 1);
    assert.equal((await reconcileLedgers()).consistent, true);
  });
});

describe('capacity and concurrency', () => {
  test('concurrent final-seat reservation yields at most one success', async () => {
    // Fill CSE/INTERNATIONAL (capacity 3) to 2, then race two batches for the last seat.
    const fill = await readyBatch('intl-fill.csv', `${HEADER}\nSTU-711,Tanvi Shah,CSE,2026-27,INTERNATIONAL,333333333311,PHONE-DEMO-I1,1,2026-08-02\nSTU-712,Aryan Kapoor,CSE,2026-27,INTERNATIONAL,333333333312,PHONE-DEMO-I2,1,2026-08-02\n`);
    assert.equal((await head.post(`/api/batches/${fill}/certify`, { declarationAccepted: true, confirmBatchId: fill })).status, 200);
    const a = await readyBatch('intl-a.csv', `${HEADER}\nSTU-713,Diya Menon,CSE,2026-27,INTERNATIONAL,333333333313,PHONE-DEMO-I3,1,2026-08-02\n`);
    const b = await readyBatch('intl-b.csv', `${HEADER}\nSTU-714,Kunal Desai,CSE,2026-27,INTERNATIONAL,333333333314,PHONE-DEMO-I4,1,2026-08-02\n`);
    const results = await Promise.all([a, b].map((id) => head.post(`/api/batches/${id}/certify`, { declarationAccepted: true, confirmBatchId: id })));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify(results.map((r) => r.body)));
    const loser = results.find((r) => r.status === 409);
    assert.equal(loser.body.error.code, 'CAPACITY_EXCEEDED');
    const intl = await ledgerFor('CSE', 'INTERNATIONAL');
    assert.equal(intl.filled, 3);
    assert.equal(intl.capacity, 3);
    const loserId = results[0].status === 409 ? a : b;
    const loserBatch = await UploadBatch.findOne({ batchId: loserId }).lean();
    assert.equal(loserBatch.status, 'NEEDS_CORRECTION');
    assert.equal(loserBatch.revalidationRequired, true);
    assert.equal(await Enrolment.countDocuments({ sourceBatchId: loserId }), 0, 'no partial commit');
    assert.equal((await reconcileLedgers()).consistent, true);
  });

  test('a forced failure inside the transaction leaves no enrolment and no seat change', async () => {
    const batchId = await readyBatch('fail.csv', `${HEADER}\nSTU-721,Nisha Pillai,CSE,2026-27,REGULAR,333333333341,PHONE-DEMO-F1,1,2026-08-02\n`);
    const before = await ledgerFor('CSE', 'REGULAR');
    const studentsBefore = await Student.countDocuments();
    testHooks.beforeFinalize = async () => { throw new Error('Simulated database failure'); };
    try {
      const res = await head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId });
      assert.equal(res.status, 500);
      assert.equal(res.body.error.code, 'COMMIT_TRANSACTION_FAILED');
      assert.ok(!JSON.stringify(res.body).includes('Simulated database failure'), 'internal error text not leaked');
    } finally {
      testHooks.beforeFinalize = null;
    }
    assert.equal(await Enrolment.countDocuments({ sourceBatchId: batchId }), 0);
    assert.equal((await ledgerFor('CSE', 'REGULAR')).filled, before.filled);
    assert.equal(await Student.countDocuments(), studentsBefore);
    const batch = await UploadBatch.findOne({ batchId }).lean();
    assert.equal(batch.status, 'COMMIT_FAILED');
    // Retry succeeds once the fault is gone.
    const retry = await head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal((await ledgerFor('CSE', 'REGULAR')).filled, before.filled + 1);
  });

  test('database validator refuses a counter above capacity even if a bug tried it', async () => {
    const ledger = await ledgerFor('CSE', 'NRI');
    await assert.rejects(SeatLedger.collection.updateOne({ _id: ledger._id }, { $set: { filled: ledger.capacity + 1 } }));
    await assert.rejects(SeatLedger.collection.updateOne({ _id: ledger._id }, { $set: { filled: -1 } }));
  });
});

describe('stale policy version', () => {
  test('publishing DEMO-v2 forces the seeded stale batch back to revalidation', async () => {
    const stale = await UploadBatch.findOne({ batchId: 'BATCH-ABC-DEMO-SEED-STALE' }).lean();
    assert.equal(stale.status, 'READY_FOR_REVIEW');
    assert.equal(stale.validatedPolicyVersion, 'DEMO-v1');
    const approver = await loginAs(ctx.app, 'approver.demo@example.test');
    const policies = (await approver.get('/api/admin/seat-policies')).body.items;
    const v2 = policies.find((p) => p.version === 'DEMO-v2');
    const published = await approver.post(`/api/admin/seat-policies/${v2.id}/publish`);
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.supersededVersion, 'DEMO-v1');

    const certify = await head.post(`/api/batches/${stale.batchId}/certify`, { declarationAccepted: true, confirmBatchId: stale.batchId });
    assert.equal(certify.status, 409);
    assert.equal(certify.body.error.code, 'STALE_POLICY_VERSION');
    assert.equal(await Enrolment.countDocuments({ sourceBatchId: stale.batchId }), 0, 'never committed with mixed capacities');
    const after = await UploadBatch.findOne({ batchId: stale.batchId }).lean();
    assert.equal(after.status, 'NEEDS_CORRECTION');

    // Operator revalidates under DEMO-v2, then it can go through normally.
    await operator.post(`/api/batches/${stale.batchId}/revalidate`);
    const again = (await operator.get(`/api/batches/${stale.batchId}`)).body;
    assert.equal(again.batch.validatedPolicyVersion, 'DEMO-v2');
    const ok = await justifyAllAndCertify({ operator, head, batchId: stale.batchId });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.commitSummary.policyVersion, 'DEMO-v2');
  });
});
