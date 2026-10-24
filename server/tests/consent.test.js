// Consent and verification (spec 08 consent group): approve, deny, expiry, revoke, wrong student,
// field tampering. Only current, approved fields are ever returned.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture, justifyAllAndCertify } = require('./helpers/testApp');
const { Consent, VerificationRequest, AccessLog, Organisation, User } = require('../src/models');
const { hashPassword } = require('../src/services/authService');

let ctx;
const s = {};
let studentRef;

async function newRequest(fields = ['displayName', 'institutionName', 'enrolmentStatus'], purpose = 'EMPLOYMENT_VERIFICATION') {
  const res = await s.verifier.post('/api/verification-requests', { studentRef, purpose, requestedFields: fields, expiryDays: 7 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const consent = await Consent.findOne({ requestId: res.body.requestId }).lean();
  return { requestId: res.body.requestId, consentId: consent.consentId };
}

before(async () => {
  ctx = await setupTestApp();
  for (const [alias, email] of Object.entries({
    operator: 'operator.demo@example.test', head: 'head.demo@example.test', verifier: 'verifier.demo@example.test', student: 'student.demo@example.test',
  })) s[alias] = await loginAs(ctx.app, email);
  // STU-001 must be in the register: commit the clean batch first (as in the demo flow).
  const { batchId } = await uploadFixture(s.operator, 'clean_batch.csv');
  assert.equal((await justifyAllAndCertify({ operator: s.operator, head: s.head, batchId })).status, 200);
  studentRef = (await s.student.get('/api/students/me')).body.student.studentRef;
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('creating requests', () => {
  test('purpose and field allow-list are enforced on the server (tampering rejected)', async () => {
    const tampered = await s.verifier.post('/api/verification-requests', { studentRef, purpose: 'EMPLOYMENT_VERIFICATION', requestedFields: ['displayName', 'externalIdDemo'], expiryDays: 7 });
    assert.equal(tampered.status, 422);
    assert.equal(tampered.body.error.code, 'FIELD_NOT_ALLOWED');
    const notForPurpose = await s.verifier.post('/api/verification-requests', { studentRef, purpose: 'EMPLOYMENT_VERIFICATION', requestedFields: ['admittedOn'], expiryDays: 7 });
    assert.equal(notForPurpose.status, 422);
    const badExpiry = await s.verifier.post('/api/verification-requests', { studentRef, purpose: 'EMPLOYMENT_VERIFICATION', requestedFields: ['displayName'], expiryDays: 365 });
    assert.equal(badExpiry.status, 422);
    const badPurpose = await s.verifier.post('/api/verification-requests', { studentRef, purpose: 'BULK_SCRAPE', requestedFields: ['displayName'], expiryDays: 7 });
    assert.equal(badPurpose.status, 422);
  });

  test('knowing a reference reveals nothing; unknown reference is rejected generically', async () => {
    const unknown = await s.verifier.post('/api/verification-requests', { studentRef: 'SR-does-not-exist', purpose: 'EMPLOYMENT_VERIFICATION', requestedFields: ['displayName'], expiryDays: 7 });
    assert.equal(unknown.status, 422);
    const { requestId } = await newRequest();
    const view = (await s.verifier.get(`/api/verification-requests/${requestId}`)).body;
    assert.equal(view.status, 'PENDING');
    assert.ok(view.studentRefMasked.includes('…'));
    assert.ok(!JSON.stringify(view).includes('Aarav'), 'no student details before consent');
    const result = await s.verifier.get(`/api/verification-requests/${requestId}/result`);
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'CONSENT_NOT_ACTIVE');
    const duplicate = await s.verifier.post('/api/verification-requests', { studentRef, purpose: 'EMPLOYMENT_VERIFICATION', requestedFields: ['displayName'], expiryDays: 7 });
    assert.equal(duplicate.status, 409);
    await s.verifier.post(`/api/verification-requests/${requestId}/cancel`);
  });

  test('verifier whose organisation is not approved cannot create requests', async () => {
    const pending = await Organisation.create({ orgCode: 'VER-PENDING1', name: 'Pending Verifier Org (test)', type: 'VERIFIER', status: 'PENDING' });
    await User.create({ emailNormalized: 'verifier.pending@example.test', displayName: 'Pending verifier', role: 'VERIFIER', status: 'ACTIVE', organisationId: pending._id, passwordHash: await hashPassword('Test-Password-2026'), isDemo: true });
    const pendingVerifier = await loginAs(ctx.app, 'verifier.pending@example.test');
    const res = await pendingVerifier.post('/api/verification-requests', { studentRef, purpose: 'EMPLOYMENT_VERIFICATION', requestedFields: ['displayName'], expiryDays: 7 });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ORG_NOT_APPROVED');
  });
});

describe('student decisions', () => {
  test('approve a subset: verifier receives only the approved fields and an access event is logged', async () => {
    const { requestId, consentId } = await newRequest(['displayName', 'institutionName', 'programName', 'enrolmentStatus']);
    const inbox = (await s.student.get('/api/consents?status=PENDING')).body.items;
    const item = inbox.find((c) => c.consentId === consentId);
    assert.equal(item.requester.name, 'Demo Employer Verification Services (synthetic)');
    assert.match(item.modeNote, /NOT a digitally signed/);
    const outside = await s.student.post(`/api/consents/${consentId}/approve`, { approvedFields: ['displayName', 'admittedOn'] });
    assert.equal(outside.status, 422, 'cannot approve a field that was not requested');
    const approve = await s.student.post(`/api/consents/${consentId}/approve`, { approvedFields: ['displayName', 'enrolmentStatus'] });
    assert.equal(approve.status, 200);
    assert.ok(approve.body.receiptHash);
    const result = await s.verifier.get(`/api/verification-requests/${requestId}/result`);
    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body.data).sort(), ['displayName', 'enrolmentStatus']);
    assert.equal(result.body.data.displayName, 'Aarav Sharma');
    assert.equal(result.body.data.enrolmentStatus, 'CONFIRMED');
    const log = (await s.student.get('/api/students/me/access-log')).body.items;
    assert.equal(log[0].requestId, requestId);
    assert.deepEqual(log[0].fieldsDisclosed.sort(), ['displayName', 'enrolmentStatus']);
    assert.equal(await AccessLog.countDocuments({ requestId }), 1);
  });

  test('revocation blocks later access', async () => {
    const { requestId, consentId } = await newRequest(['displayName'], 'SCHOLARSHIP_VERIFICATION');
    await s.student.post(`/api/consents/${consentId}/approve`, { approvedFields: ['displayName'] });
    assert.equal((await s.verifier.get(`/api/verification-requests/${requestId}/result`)).status, 200);
    const revoke = await s.student.post(`/api/consents/${consentId}/revoke`, { note: 'No longer applying.' });
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.status, 'REVOKED');
    const after = await s.verifier.get(`/api/verification-requests/${requestId}/result`);
    assert.equal(after.status, 403);
    assert.equal((await s.verifier.get(`/api/verification-requests/${requestId}`)).body.status, 'REVOKED');
  });

  test('denial releases no data', async () => {
    const { requestId, consentId } = await newRequest(['displayName'], 'HIGHER_EDUCATION_ADMISSION');
    assert.equal((await s.student.post(`/api/consents/${consentId}/deny`, {})).status, 200);
    assert.equal((await s.verifier.get(`/api/verification-requests/${requestId}/result`)).status, 403);
    assert.equal((await s.student.post(`/api/consents/${consentId}/approve`, { approvedFields: ['displayName'] })).status, 409, 'a denied request cannot be approved later');
  });

  test('expired consent cannot be used', async () => {
    const { requestId, consentId } = await newRequest(['displayName'], 'EDUCATION_LOAN_VERIFICATION');
    await s.student.post(`/api/consents/${consentId}/approve`, { approvedFields: ['displayName'] });
    const past = new Date(Date.now() - 1000);
    await Consent.updateOne({ consentId }, { $set: { expiresAt: past } });
    await VerificationRequest.updateOne({ requestId }, { $set: { expiresAt: past } });
    const res = await s.verifier.get(`/api/verification-requests/${requestId}/result`);
    assert.equal(res.status, 403);
    assert.equal((await Consent.findOne({ consentId }).lean()).status, 'EXPIRED');
  });

  test('a verifier cannot read another verifier\'s request', async () => {
    const { requestId } = await newRequest(['displayName'], 'EMPLOYMENT_VERIFICATION');
    const otherOrg = await Organisation.create({ orgCode: 'VER-OTHER01', name: 'Other Verifier (test)', type: 'VERIFIER', status: 'APPROVED' });
    await User.create({ emailNormalized: 'verifier.other@example.test', displayName: 'Other verifier', role: 'VERIFIER', status: 'ACTIVE', organisationId: otherOrg._id, passwordHash: await hashPassword('Test-Password-2026'), isDemo: true });
    const other = await loginAs(ctx.app, 'verifier.other@example.test');
    assert.equal((await other.get(`/api/verification-requests/${requestId}`)).status, 404);
    assert.equal((await other.get(`/api/verification-requests/${requestId}/result`)).status, 404);
    assert.equal((await other.post(`/api/verification-requests/${requestId}/cancel`)).status, 404);
    const cancel = await s.verifier.post(`/api/verification-requests/${requestId}/cancel`);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.status, 'CANCELLED');
  });
});
