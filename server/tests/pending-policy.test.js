// PENDING identity checks follow the documented admin setting (spec 07: "batch decision follows
// explicit pending policy; default is do not imply verified").
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture, currentIssues, justifyAllAndCertify } = require('./helpers/testApp');
const { Enrolment, Student, UploadBatch } = require('../src/models');

let ctx;
let operator;
let head;
let admin;

before(async () => {
  ctx = await setupTestApp();
  operator = await loginAs(ctx.app, 'operator.demo@example.test');
  head = await loginAs(ctx.app, 'head.demo@example.test');
  admin = await loginAs(ctx.app, 'admin.demo@example.test');
});
after(async () => { if (ctx) await ctx.cleanup(); });

test('default policy blocks; switching policy forces revalidation; committed rows stay PROVISIONAL and unverified', async () => {
  const { batchId } = await uploadFixture(operator, 'registry_pending.csv');
  let detail = (await operator.get(`/api/batches/${batchId}`)).body;
  assert.equal(detail.batch.status, 'NEEDS_CORRECTION');
  assert.ok(detail.readiness.markReadyBlockers.some((b) => b.code === 'PENDING_CHECKS'));
  const pending = (await currentIssues(operator, batchId)).filter((i) => i.severity === 'PENDING');
  const notAllowed = await operator.post(`/api/batches/${batchId}/issues/${pending[0].id}/justify`, { justification: 'Trying to justify under the blocking policy.' });
  assert.equal(notAllowed.status, 422, 'cannot justify while the policy blocks');

  const changed = await admin.put('/api/admin/settings', { changes: { pendingIdentityPolicy: 'ALLOW_WITH_HEAD_DISPOSITION' }, reason: 'Demo of the alternative pending policy.' });
  assert.equal(changed.status, 200);
  const flagged = await UploadBatch.findOne({ batchId }).lean();
  assert.equal(flagged.revalidationRequired, true);
  assert.equal(flagged.revalidationReason, 'PENDING_POLICY_CHANGED');

  assert.equal((await operator.post(`/api/batches/${batchId}/revalidate`)).status, 202);
  detail = (await operator.get(`/api/batches/${batchId}`)).body;
  assert.equal(detail.batch.status, 'VALIDATED');
  assert.ok(detail.readiness.markReadyBlockers.some((b) => b.code === 'JUSTIFICATIONS_MISSING'), 'pending checks now need a disposition');

  const certified = await justifyAllAndCertify({ operator, head, batchId });
  assert.equal(certified.status, 200, JSON.stringify(certified.body));
  assert.equal(certified.body.commitSummary.provisionalEnrolments, 2);
  const enrolments = await Enrolment.find({ sourceBatchId: batchId }).lean();
  assert.ok(enrolments.every((e) => e.state === 'PROVISIONAL' && e.identityStatusAtCommit === 'PENDING'));
  const students = await Student.find({ studentCode: { $in: ['STU-321', 'STU-322'] } }).lean();
  assert.ok(students.every((s) => s.externalLinkStatus === 'PENDING'), 'never shown as identity-verified');

  // The head can later confirm a provisional enrolment (no seat change).
  const confirm = await head.patch(`/api/enrolments/${enrolments[0].enrolmentRef}/state`, { toState: 'CONFIRMED', reason: 'Identity re-checked through the institution process.' });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.seatEffect, 'NONE');
});
