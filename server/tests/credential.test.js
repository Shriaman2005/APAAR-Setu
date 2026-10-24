// Prototype credentials and public QR status (spec 08 QR group).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture, justifyAllAndCertify, request } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { Enrolment, Institution, Credential } = require('../src/models');
const { isWellFormedRef } = require('../src/services/credentialService');

let ctx;
const s = {};
let enrolmentRef;
let credentialRef;

before(async () => {
  ctx = await setupTestApp();
  for (const [alias, email] of Object.entries({
    operator: 'operator.demo@example.test', head: 'head.demo@example.test', issuer: 'issuer.demo@example.test', student: 'student.demo@example.test',
  })) s[alias] = await loginAs(ctx.app, email);
  const { batchId } = await uploadFixture(s.operator, 'clean_batch.csv');
  assert.equal((await justifyAllAndCertify({ operator: s.operator, head: s.head, batchId })).status, 200);
  const record = (await s.student.get('/api/students/me')).body;
  enrolmentRef = record.enrolments[0].enrolmentRef;
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('issuing', () => {
  test('issuer search returns masked records within scope only', async () => {
    const res = await s.issuer.get('/api/issuer/eligible-students?search=STU-001');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].studentInitials, 'A. S.');
    assert.ok(res.body.items[0].studentCodeMasked.includes('*'));
  });

  test('issuer issues a demo credential; repeating is idempotent', async () => {
    const first = await s.issuer.post('/api/credentials', { enrolmentRef, credentialType: 'ENROLMENT_CERTIFICATE_DEMO' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    credentialRef = first.body.credential.credentialRef;
    assert.ok(isWellFormedRef(credentialRef, 'test-credential-secret'));
    assert.equal(first.body.credential.verificationMode, 'URL_REFERENCE_UNSIGNED_DEMO');
    assert.equal(first.body.credential.mockDigiLockerPush.status, 'SIMULATED_NOT_SENT');
    assert.match(first.body.verifyUrl, /\/verify\/CRD-/);
    const again = await s.issuer.post('/api/credentials', { enrolmentRef, credentialType: 'ENROLMENT_CERTIFICATE_DEMO' });
    assert.equal(again.status, 200);
    assert.equal(again.body.idempotentReplay, true);
    assert.equal(await Credential.countDocuments({ enrolmentRef, status: 'ACTIVE' }), 1);
  });

  test('ineligible type and out-of-scope records are refused', async () => {
    const wrongType = await s.issuer.post('/api/credentials', { enrolmentRef, credentialType: 'COMPLETION_CERTIFICATE_DEMO' });
    assert.equal(wrongType.status, 422);
    const xyz = await Institution.findOne({ institutionCode: 'XYZ-DEMO' }).lean();
    const outside = await Enrolment.findOne({ institutionId: xyz._id, state: 'CONFIRMED' }).lean();
    assert.equal((await s.issuer.post('/api/credentials', { enrolmentRef: outside.enrolmentRef, credentialType: 'ENROLMENT_CERTIFICATE_DEMO' })).status, 404);
  });

  test('student sees own credential and can download the QR image', async () => {
    const list = (await s.student.get('/api/students/me/credentials')).body.items;
    assert.equal(list[0].credentialRef, credentialRef);
    const qr = await s.student.get(`/api/credentials/${credentialRef}/qr.png`);
    assert.equal(qr.status, 200);
    assert.equal(qr.headers['content-type'], 'image/png');
    assert.ok(qr.body.length > 100);
  });
});

describe('public verification', () => {
  test('valid credential shows minimal status with no personal data', async () => {
    const res = await request(ctx.app).get(`/api/verify/${credentialRef}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'VALID');
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('Aarav') && !text.includes('STU-001') && !text.includes('111111111111'), 'no personal data');
    assert.match(res.body.disclaimer, /NOT a cryptographically signed credential/);
  });

  test('altered or malformed references return INVALID_OR_TAMPERED', async () => {
    const altered = credentialRef.slice(0, -1) + (credentialRef.endsWith('0') ? '1' : '0');
    assert.equal((await request(ctx.app).get(`/api/verify/${altered}`)).body.status, 'INVALID_OR_TAMPERED');
    assert.equal((await request(ctx.app).get('/api/verify/not-a-reference')).body.status, 'INVALID_OR_TAMPERED');
    const randomPart = credentialRef.slice(4, 36).replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
    assert.equal((await request(ctx.app).get(`/api/verify/CRD-${randomPart}-${credentialRef.slice(-12)}`)).body.status, 'INVALID_OR_TAMPERED');
  });

  test('anonymous enumeration attempts get generic answers and are rate-limited', async () => {
    const limited = createApp({ ...ctx.config, rateLimits: { ...ctx.config.rateLimits, publicVerifyMax: 5 } });
    const statuses = [];
    for (let i = 1; i <= 6; i += 1) {
      const res = await request(limited).get(`/api/verify/CRD-${String(i).padStart(32, '0')}-000000000000`);
      statuses.push(res.status);
      if (res.status === 200) assert.equal(res.body.status, 'INVALID_OR_TAMPERED');
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  });

  test('revocation is reflected by the same status endpoint', async () => {
    assert.equal((await s.issuer.post(`/api/credentials/${credentialRef}/revoke`, { reason: 'x' })).status, 422);
    const revoke = await s.issuer.post(`/api/credentials/${credentialRef}/revoke`, { reason: 'Issued for the wrong programme (synthetic test).' });
    assert.equal(revoke.status, 200);
    assert.equal(revoke.body.status, 'REVOKED');
    const res = await request(ctx.app).get(`/api/verify/${credentialRef}`);
    assert.equal(res.body.status, 'REVOKED');
    assert.equal((await s.issuer.post(`/api/credentials/${credentialRef}/revoke`, { reason: 'Revoking a second time.' })).status, 409);
    assert.equal((await s.student.post(`/api/credentials/${credentialRef}/revoke`, { reason: 'Student cannot revoke a credential.' })).status, 403);
  });

  test('issuer export masks student names', async () => {
    const res = await s.issuer.get('/api/credentials/export.csv');
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('Aarav Sharma'));
    assert.ok(res.text.includes('A. S.'));
  });
});
