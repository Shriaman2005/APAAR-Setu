// Quick end-to-end smoke test of the critical path: seed -> login -> upload -> certify.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture, justifyAllAndCertify } = require('./helpers/testApp');
const { Enrolment, SeatLedger } = require('../src/models');

let ctx;
before(async () => { ctx = await setupTestApp(); });
after(async () => { if (ctx) await ctx.cleanup(); });

test('health endpoint reports a replica set with transactions', async () => {
  const { request } = require('./helpers/testApp');
  const res = await request(ctx.app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.transactionsSupported, true);
});

test('operator uploads clean batch and head certifies it', async () => {
  const operator = await loginAs(ctx.app, 'operator.demo@example.test');
  const head = await loginAs(ctx.app, 'head.demo@example.test');
  const { batchId, body } = await uploadFixture(operator, 'clean_batch.csv');
  assert.equal(body.receivedRows, 4);
  const detail = await operator.get(`/api/batches/${batchId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.batch.status, 'VALIDATED', JSON.stringify(detail.body.batch.counts));
  const before = await SeatLedger.findOne({ courseCode: 'CSE', bucketCode: 'REGULAR', regionId: 'REGION-DEMO' }).lean();
  const certified = await justifyAllAndCertify({ operator, head, batchId });
  assert.equal(certified.status, 200, JSON.stringify(certified.body));
  assert.equal(certified.body.status, 'COMMITTED');
  assert.equal(await Enrolment.countDocuments({ sourceBatchId: batchId }), 4);
  const afterLedger = await SeatLedger.findById(before._id).lean();
  assert.equal(afterLedger.filled, before.filled + 4);
});
