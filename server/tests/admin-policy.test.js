// System administration: users, organisations, settings and seat-policy maker-checker.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, csrfFor, request } = require('./helpers/testApp');
const { User, Institution, SeatLedger, SeatPolicy } = require('../src/models');

let ctx;
const s = {};

before(async () => {
  ctx = await setupTestApp();
  for (const [alias, email] of Object.entries({
    admin: 'admin.demo@example.test', approver: 'approver.demo@example.test', national: 'national.demo@example.test', verifier: 'verifier.demo@example.test',
  })) s[alias] = await loginAs(ctx.app, email);
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('user management', () => {
  test('user list never exposes password hashes', async () => {
    const res = await s.admin.get('/api/admin/users?pageSize=100');
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
    assert.ok(res.body.items.length >= 11);
  });

  test('create user validates role allow-list and role-specific scope', async () => {
    const badRole = await s.admin.post('/api/admin/users', { email: 'x@example.test', displayName: 'X Person', role: 'SUPER_ADMIN' });
    assert.equal(badRole.status, 422);
    const missingScope = await s.admin.post('/api/admin/users', { email: 'op2@example.test', displayName: 'Operator Two', role: 'COLLEGE_OPERATOR' });
    assert.equal(missingScope.status, 422);
    assert.ok(missingScope.body.error.details.fieldErrors.institutionId);
    const wrongScope = await s.admin.post('/api/admin/users', { email: 'nat2@example.test', displayName: 'National Two', role: 'AICTE_NATIONAL_OFFICER', regionIds: ['REGION-DEMO'] });
    assert.equal(wrongScope.status, 422);
    const badRegion = await s.admin.post('/api/admin/users', { email: 'reg2@example.test', displayName: 'Regional Two', role: 'AICTE_REGIONAL_OFFICER', regionIds: ['REGION-MARS'] });
    assert.equal(badRegion.status, 422);
  });

  test('new account is invitation-pending and activates through a one-time link', async () => {
    const abc = await Institution.findOne({ institutionCode: 'ABC-DEMO' }).lean();
    const res = await s.admin.post('/api/admin/users', { email: 'new.operator@example.test', displayName: 'New Operator', role: 'COLLEGE_OPERATOR', institutionId: String(abc._id) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.user.status, 'PENDING_ACTIVATION');
    assert.match(res.body.deliveryNote, /no email is sent/i);
    const agent = request.agent(ctx.app);
    const csrf = await csrfFor(agent);
    const before = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'new.operator@example.test', password: 'Anything-12345' });
    assert.equal(before.status, 401, 'cannot sign in before activation');
    const token = new URL(res.body.activationLink).searchParams.get('token');
    const activate = await agent.post('/api/auth/set-password').set('X-CSRF-Token', csrf).send({ token, newPassword: 'Activated-Pass-42' });
    assert.equal(activate.status, 200);
    assert.equal(activate.body.purpose, 'ACTIVATION');
    const op = await loginAs(ctx.app, 'new.operator@example.test', 'Activated-Pass-42');
    assert.equal(op.user.role, 'COLLEGE_OPERATOR');
    assert.equal((await s.admin.post('/api/admin/users', { email: 'NEW.operator@example.test', displayName: 'Dup', role: 'AICTE_NATIONAL_OFFICER' })).status, 409);
  });

  test('roles cannot be changed and admins cannot escalate or disable themselves', async () => {
    const verifier = await User.findOne({ emailNormalized: 'verifier.demo@example.test' }).lean();
    const roleChange = await s.admin.patch(`/api/admin/users/${verifier._id}`, { role: 'AICTE_SYSTEM_ADMIN' });
    assert.equal(roleChange.status, 422);
    assert.equal(roleChange.body.error.code, 'ROLE_CHANGE_NOT_ALLOWED');
    const self = await User.findOne({ emailNormalized: 'admin.demo@example.test' }).lean();
    assert.equal((await s.admin.post(`/api/admin/users/${self._id}/disable`, { reason: 'Trying to disable my own account.' })).status, 422);
    assert.equal((await s.admin.patch(`/api/admin/users/${self._id}`, { regionIds: ['REGION-DEMO'] })).status, 422);
    const rename = await s.admin.patch(`/api/admin/users/${verifier._id}`, { displayName: 'Renamed Verifier' });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.displayName, 'Renamed Verifier');
  });

  test('student accounts link to an existing register student exactly once', async () => {
    const missing = await s.admin.post('/api/admin/users', { email: 'stu@example.test', displayName: 'Student X', role: 'STUDENT', studentCode: 'STU-999' });
    assert.equal(missing.status, 422);
    const taken = await s.admin.post('/api/admin/users', { email: 'stu2@example.test', displayName: 'Student Y', role: 'STUDENT', studentCode: 'STU-001' });
    assert.equal(taken.status, 422, 'STU-001 already has the demo student account');
    const free = await s.admin.post('/api/admin/users', { email: 'stu3@example.test', displayName: 'Rohan Mehta', role: 'STUDENT', studentCode: 'STU-005' });
    assert.equal(free.status, 201);
  });
});

describe('organisations and settings', () => {
  test('verifier onboarding creates a pending organisation that an admin approves', async () => {
    await User.create({ emailNormalized: 'verifier.new@example.test', displayName: 'New Verifier', role: 'VERIFIER', status: 'ACTIVE', passwordHash: await require('../src/services/authService').hashPassword('Test-Password-2026'), isDemo: true });
    const verifier = await loginAs(ctx.app, 'verifier.new@example.test');
    assert.equal((await verifier.get('/api/verifier/organisation')).body.organisation, null);
    const submit = await verifier.post('/api/verifier/organisation', { name: 'New Employer (test)', verifierCategory: 'EMPLOYER' });
    assert.equal(submit.status, 201);
    assert.equal(submit.body.organisation.status, 'PENDING');
    assert.equal((await verifier.post('/api/verifier/organisation', { name: 'Again', verifierCategory: 'EMPLOYER' })).status, 409);
    const approve = await s.admin.post(`/api/admin/organisations/${submit.body.organisation.id}/approve`, { reason: 'Prototype approval (no real KYC).' });
    assert.equal(approve.status, 200);
    assert.equal((await verifier.get('/api/verifier/organisation')).body.organisation.status, 'APPROVED');
  });

  test('only documented demo settings can be changed, with a reason', async () => {
    assert.equal((await s.admin.put('/api/admin/settings', { changes: { sessionSecret: 'x' }, reason: 'Trying to set an undocumented key.' })).status, 422);
    assert.equal((await s.admin.put('/api/admin/settings', { changes: { conflictReviewSlaDays: 500 }, reason: 'Out of range value test.' })).status, 422);
    const ok = await s.admin.put('/api/admin/settings', { changes: { conflictReviewSlaDays: 10 }, reason: 'Shorter review target for the demo.' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.items.find((i) => i.key === 'conflictReviewSlaDays').value, 10);
  });
});

describe('seat policy maker-checker', () => {
  let draftId;
  const scopes = [{ institutionCode: 'LMN-DEMO', courseCode: 'DME', buckets: [{ code: 'REGULAR', capacity: 50, countsWithinIntake: true }, { code: 'TFW', capacity: 3, countsWithinIntake: false }] }];

  test('draft validation catches over-intake capacity and capacity below filled', async () => {
    const bad = await s.admin.post('/api/admin/seat-policies', {
      academicYear: '2026-27', version: 'DEMO-v9', sourceReference: 'TEST-FIXTURE-BAD', admissionWindow: { opensOn: '2026-07-01', closesOn: '2026-09-30' },
      scopes: [{ institutionCode: 'LMN-DEMO', courseCode: 'DME', buckets: [{ code: 'REGULAR', capacity: 61, countsWithinIntake: true }, { code: 'TFW', capacity: 0, countsWithinIntake: false }] }],
    });
    assert.equal(bad.status, 201);
    const validated = await s.admin.post(`/api/admin/seat-policies/${bad.body.id}/validate`);
    assert.equal(validated.body.lastValidation.status, 'FAILED');
    assert.ok(validated.body.lastValidation.errors.some((e) => /approved intake/.test(e)));
    assert.equal((await s.admin.post(`/api/admin/seat-policies/${bad.body.id}/submit`)).status, 422, 'cannot submit a failing draft');
  });

  test('approval must come from a different administrator and publishing updates the ledger', async () => {
    const draft = await s.admin.post('/api/admin/seat-policies', {
      academicYear: '2026-27', version: 'DEMO-v3', sourceReference: 'TEST-FIXTURE-V3', admissionWindow: { opensOn: '2026-07-01', closesOn: '2026-09-30' },
      scopes: (await SeatPolicy.findOne({ version: 'DEMO-v1' }).lean()).scopes.map((scope) => (scope.institutionCode === 'LMN-DEMO' ? scopes[0] : scope)),
    });
    draftId = draft.body.id;
    assert.equal((await s.admin.post(`/api/admin/seat-policies/${draftId}/validate`)).body.lastValidation.status, 'PASSED');
    assert.equal((await s.admin.post(`/api/admin/seat-policies/${draftId}/submit`)).status, 200);
    const selfApprove = await s.admin.post(`/api/admin/seat-policies/${draftId}/publish`);
    assert.equal(selfApprove.status, 403);
    assert.equal(selfApprove.body.error.code, 'MAKER_CHECKER_VIOLATION');
    // DEMO-v2 (seeded) is also pending; publishing v3 makes v1 superseded and keeps it.
    const published = await s.approver.post(`/api/admin/seat-policies/${draftId}/publish`);
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const lmn = await Institution.findOne({ institutionCode: 'LMN-DEMO' }).lean();
    const ledger = await SeatLedger.findOne({ institutionId: lmn._id, bucketCode: 'REGULAR' }).lean();
    assert.equal(ledger.capacity, 50);
    assert.equal(ledger.policyVersion, 'DEMO-v3');
    const v1 = await SeatPolicy.findOne({ version: 'DEMO-v1' }).lean();
    assert.equal(v1.status, 'SUPERSEDED', 'previous version retained');
    assert.equal(await SeatPolicy.countDocuments({ academicYear: '2026-27', status: 'PUBLISHED' }), 1);
  });

  test('versions can be compared and national officers have read-only access', async () => {
    const v1 = await SeatPolicy.findOne({ version: 'DEMO-v1' }).lean();
    const res = await s.national.get(`/api/admin/seat-policies/compare?from=${v1._id}&to=${draftId}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.differences.some((d) => d.key === 'LMN-DEMO/DME/REGULAR' && d.change === 'CHANGED'));
    assert.equal((await s.national.post(`/api/admin/seat-policies/${draftId}/validate`)).status, 403);
  });
});
