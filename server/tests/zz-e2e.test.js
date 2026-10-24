// End-to-end journey through the API with background (async) validation, covering the
// highest-value acceptance flow across roles (spec 01 section 7, spec 10 section 7).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, currentIssues, request } = require('./helpers/testApp');
const { reconcileLedgers } = require('../src/services/seatLedgerService');

let ctx;
before(async () => { ctx = await setupTestApp({ config: { validationMode: 'async' } }); });
after(async () => { if (ctx) await ctx.cleanup(); });

async function waitForValidation(session, batchId) {
  for (let i = 0; i < 100; i += 1) {
    const body = (await session.get(`/api/batches/${batchId}`)).body;
    if (!['UPLOADED', 'VALIDATING'].includes(body.batch.status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('validation did not finish');
}

test('complete demo journey across all roles', async () => {
  // 1-2. Operator signs in and uploads a synthetic CSV with one error.
  const operator = await loginAs(ctx.app, 'operator.demo@example.test');
  const csv = [
    'studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn',
    'STU-001,Aarav Sharma,CSE,2026-27,REGULAR,111111111111,PHONE-DEMO-A,1,2026-08-01',
    'STU-002,Neha Verma,,2026-27,REGULAR,222222222222,PHONE-DEMO-B,1,2026-08-02',
    'STU-003,Kabir Singh,CSE,2026-27,REGULAR,444444444444,PHONE-DEMO-C,1,2026-08-03',
  ].join('\n');
  const upload = await operator.upload('journey.csv', { content: csv });
  assert.equal(upload.status, 202);
  assert.equal(upload.body.status, 'VALIDATING');
  const { batchId } = upload.body;

  // 3. Inspect validation results.
  let detail = await waitForValidation(operator, batchId);
  assert.equal(detail.batch.status, 'NEEDS_CORRECTION');
  const errors = (await currentIssues(operator, batchId)).filter((i) => i.severity === 'ERROR');
  assert.deepEqual(errors.map((e) => [e.rowNumber, e.field]), [[3, 'courseCode']]);

  // 4. Correct the record and revalidate.
  assert.equal((await operator.patch(`/api/batches/${batchId}/rows/3`, { changes: { courseCode: 'CSE' } })).status, 200);
  assert.equal((await operator.post(`/api/batches/${batchId}/revalidate`)).status, 202);
  detail = await waitForValidation(operator, batchId);
  assert.equal(detail.batch.status, 'VALIDATED');
  assert.equal(detail.batch.validationRunCount, 2);

  // 5. Submit for certification.
  assert.equal((await operator.post(`/api/batches/${batchId}/mark-ready`, { note: 'All rows checked.' })).status, 200);

  // 6-7. Separate college head reviews and certifies.
  const head = await loginAs(ctx.app, 'head.demo@example.test');
  const review = (await head.get(`/api/batches/${batchId}/review`)).body;
  assert.equal(review.readiness.canCertify, true);
  assert.ok(review.ledgerImpact.every((row) => row.fits));
  assert.match(review.declaration.text, /not a legal instrument/);
  const certified = await head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId });
  assert.equal(certified.status, 200, JSON.stringify(certified.body));

  // 8. Final records and seat counts are consistent.
  const ledger = (await head.get(`/api/institutions/${head.user.institution.id}/seat-ledger?academicYear=2026-27`)).body;
  assert.ok(ledger.buckets.find((b) => b.courseCode === 'CSE' && b.bucketCode === 'REGULAR').filled >= 4);
  assert.equal((await reconcileLedgers()).consistent, true);

  // 9. Cross-college conflict exercised by the college heads and the regional officer.
  const regional = await loginAs(ctx.app, 'regional.demo@example.test');
  const conflicts = (await regional.get('/api/conflicts?status=OPEN_ALL')).body.items;
  assert.equal(conflicts.length, 1);
  const headXyz = await loginAs(ctx.app, 'head.xyz.demo@example.test');
  const transfer = await headXyz.post(`/api/conflicts/${conflicts[0].conflictId}/resolve`, { action: 'TRANSFER_OWN_ENROLMENT', reason: 'Student moved to ABC Institute (verified).' });
  assert.equal(transfer.body.status, 'RESOLVED');

  // 10. Student consent and verifier workflow.
  const student = await loginAs(ctx.app, 'student.demo@example.test');
  const studentRef = (await student.get('/api/students/me')).body.student.studentRef;
  const verifier = await loginAs(ctx.app, 'verifier.demo@example.test');
  const vr = await verifier.post('/api/verification-requests', { studentRef, purpose: 'EMPLOYMENT_VERIFICATION', requestedFields: ['displayName', 'programName', 'enrolmentStatus'], expiryDays: 7 });
  assert.equal(vr.status, 201);
  const consent = (await student.get('/api/consents?status=PENDING')).body.items[0];
  assert.equal((await student.post(`/api/consents/${consent.consentId}/approve`, { approvedFields: ['displayName', 'enrolmentStatus'] })).status, 200);
  const result = (await verifier.get(`/api/verification-requests/${vr.body.requestId}/result`)).body;
  assert.deepEqual(Object.keys(result.data).sort(), ['displayName', 'enrolmentStatus']);

  // QR: issuer creates a demo credential, the public page reports VALID, then REVOKED.
  const issuer = await loginAs(ctx.app, 'issuer.demo@example.test');
  const enrolmentRef = (await student.get('/api/students/me')).body.enrolments[0].enrolmentRef;
  const credential = (await issuer.post('/api/credentials', { enrolmentRef, credentialType: 'ENROLMENT_CERTIFICATE_DEMO' })).body.credential;
  assert.equal((await request(ctx.app).get(`/api/verify/${credential.credentialRef}`)).body.status, 'VALID');
  await issuer.post(`/api/credentials/${credential.credentialRef}/revoke`, { reason: 'Demo revocation for the journey test.' });
  assert.equal((await request(ctx.app).get(`/api/verify/${credential.credentialRef}`)).body.status, 'REVOKED');

  // 11. Audit history and integrity check.
  const national = await loginAs(ctx.app, 'national.demo@example.test');
  const timeline = (await operator.get(`/api/batches/${batchId}/history`)).body.events.map((e) => e.action);
  for (const action of ['BATCH_UPLOADED', 'BATCH_VALIDATED', 'BATCH_ROW_CORRECTED', 'BATCH_MARKED_READY', 'BATCH_CERTIFIED_COMMITTED']) {
    assert.ok(timeline.includes(action), `timeline has ${action}`);
  }
  const chain = (await national.post('/api/audit/verify-chain')).body;
  assert.equal(chain.status, 'PASS');
});
