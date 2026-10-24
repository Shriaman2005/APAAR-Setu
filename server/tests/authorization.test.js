// Role-based and scope-based authorization (spec 03 sections 4 and 8, spec 08 authorization group).
// Every role gets positive (allowed) and negative (forbidden) checks on the backend.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture } = require('./helpers/testApp');
const { User, Institution, Consent, Enrolment, UploadBatch } = require('../src/models');
const { hashPassword } = require('../src/services/authService');

let ctx;
const s = {}; // signed-in sessions by alias
let abcBatchId;

before(async () => {
  ctx = await setupTestApp();
  // An extra regional officer for a different region, to prove regional isolation.
  await User.create({
    emailNormalized: 'regional.east@example.test', displayName: 'East Regional Officer (test)', role: 'AICTE_REGIONAL_OFFICER',
    status: 'ACTIVE', regionIds: ['REGION-EAST-DEMO'], passwordHash: await hashPassword('Test-Password-2026'), isDemo: true,
  });
  const accounts = {
    operator: 'operator.demo@example.test', head: 'head.demo@example.test', national: 'national.demo@example.test',
    regional: 'regional.demo@example.test', admin: 'admin.demo@example.test', issuer: 'issuer.demo@example.test',
    verifier: 'verifier.demo@example.test', student: 'student.demo@example.test', operatorXyz: 'operator.xyz.demo@example.test',
    headXyz: 'head.xyz.demo@example.test', regionalEast: 'regional.east@example.test',
  };
  for (const [alias, email] of Object.entries(accounts)) s[alias] = await loginAs(ctx.app, email);
  abcBatchId = (await uploadFixture(s.operator, 'missing_required_field.csv')).batchId;
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('permission matrix: positive and negative checks per role', () => {
  const cases = [
    // [alias, method, path, expected status]
    ['operator', 'get', '/api/dashboard/college', 200],
    ['operator', 'get', '/api/batches/template-info', 200],
    ['operator', 'get', '/api/dashboard/aicte/national', 403],
    ['operator', 'get', '/api/admin/users', 403],
    ['operator', 'get', '/api/risk-cases', 403],
    ['head', 'get', '/api/dashboard/college', 200],
    ['head', 'get', '/api/audit', 200],
    ['head', 'get', '/api/batches/template-info', 403],
    ['head', 'get', '/api/admin/settings', 403],
    ['national', 'get', '/api/dashboard/aicte/national', 200],
    ['national', 'get', '/api/risk-cases', 200],
    ['national', 'get', '/api/admin/seat-policies', 200],
    ['national', 'get', '/api/batches', 403],
    ['national', 'get', '/api/admin/users', 403],
    ['regional', 'get', '/api/dashboard/aicte/region', 200],
    ['regional', 'get', '/api/dashboard/aicte/national', 403],
    ['regional', 'get', '/api/admin/seat-policies', 403],
    ['admin', 'get', '/api/admin/users', 200],
    ['admin', 'get', '/api/dashboard/admin', 200],
    ['admin', 'get', '/api/batches', 403],
    ['admin', 'get', '/api/risk-cases', 403],
    ['admin', 'get', '/api/conflicts', 403],
    ['issuer', 'get', '/api/issuer/eligible-students', 200],
    ['issuer', 'get', '/api/enrolments', 403],
    ['issuer', 'get', '/api/dashboard/college', 403],
    ['verifier', 'get', '/api/verification-requests', 200],
    ['verifier', 'get', '/api/enrolments', 403],
    ['verifier', 'get', '/api/students/me', 403],
    ['student', 'get', '/api/students/me', 200],
    ['student', 'get', '/api/consents', 200],
    ['student', 'get', '/api/enrolments', 403],
    ['student', 'get', '/api/audit', 403],
  ];
  for (const [alias, method, path, expected] of cases) {
    test(`${alias} ${method.toUpperCase()} ${path} -> ${expected}`, async () => {
      const res = await s[alias][method](path);
      assert.equal(res.status, expected, JSON.stringify(res.body));
    });
  }
});

describe('maker-checker and role boundaries', () => {
  test('operator cannot call the certification endpoint directly', async () => {
    const res = await s.operator.post(`/api/batches/${abcBatchId}/certify`, { declarationAccepted: true, confirmBatchId: abcBatchId });
    assert.equal(res.status, 403);
  });

  test('operator cannot return or accept dispositions; head cannot edit staging rows', async () => {
    assert.equal((await s.operator.post(`/api/batches/${abcBatchId}/return`, { reason: 'Operator trying to act as head' })).status, 403);
    assert.equal((await s.operator.post(`/api/batches/${abcBatchId}/dispositions`, { issueIds: ['x'], reason: 'Operator trying to act as head' })).status, 403);
    assert.equal((await s.head.patch(`/api/batches/${abcBatchId}/rows/2`, { changes: { courseCode: 'CSE' } })).status, 403);
    assert.equal((await s.head.post(`/api/batches/${abcBatchId}/revalidate`)).status, 403);
  });

  test('system administrator cannot certify a batch', async () => {
    const res = await s.admin.post(`/api/batches/${abcBatchId}/certify`, { declarationAccepted: true, confirmBatchId: abcBatchId });
    assert.equal(res.status, 403);
  });

  test('national officer cannot publish or create seat policies', async () => {
    const list = await s.national.get('/api/admin/seat-policies');
    const pending = list.body.items.find((p) => p.status === 'PENDING_APPROVAL');
    assert.equal((await s.national.post(`/api/admin/seat-policies/${pending.id}/publish`)).status, 403);
    assert.equal((await s.national.post('/api/admin/seat-policies', {})).status, 403);
  });
});

describe('institution isolation (changing IDs in the URL)', () => {
  test('College B cannot read or mutate College A batch', async () => {
    assert.equal((await s.operatorXyz.get(`/api/batches/${abcBatchId}`)).status, 404);
    assert.equal((await s.operatorXyz.get(`/api/batches/${abcBatchId}/issues`)).status, 404);
    assert.equal((await s.operatorXyz.patch(`/api/batches/${abcBatchId}/rows/2`, { changes: { courseCode: 'CSE' } })).status, 404);
    assert.equal((await s.headXyz.post(`/api/batches/${abcBatchId}/return`, { reason: 'Head of another college' })).status, 404);
    const batch = await UploadBatch.findOne({ batchId: abcBatchId }).lean();
    assert.equal(batch.status, 'NEEDS_CORRECTION', 'batch unchanged');
  });

  test('College B batch list never includes College A batches', async () => {
    const res = await s.operatorXyz.get('/api/batches');
    assert.equal(res.status, 200);
    assert.ok(res.body.items.every((b) => !b.batchId.includes('ABC-DEMO')));
  });

  test('College B cannot read College A seat ledger or enrolments', async () => {
    const abc = await Institution.findOne({ institutionCode: 'ABC-DEMO' }).lean();
    assert.equal((await s.operatorXyz.get(`/api/institutions/${abc._id}/seat-ledger`)).status, 404);
    assert.equal((await s.operator.get(`/api/institutions/${abc._id}/seat-ledger`)).status, 200);
    const abcEnrolment = await Enrolment.findOne({ institutionId: abc._id }).lean();
    assert.equal((await s.headXyz.get(`/api/enrolments/${abcEnrolment.enrolmentRef}`)).status, 404);
    assert.equal((await s.headXyz.patch(`/api/enrolments/${abcEnrolment.enrolmentRef}/state`, { toState: 'WITHDRAWN', reason: 'Trying to change another college record' })).status, 404);
  });

  test('scope fields in the body are rejected, not trusted', async () => {
    const res = await s.operator.patch(`/api/batches/${abcBatchId}/rows/2`, { changes: { courseCode: 'CSE' }, institutionId: 'x' });
    assert.equal(res.status, 422);
  });
});

describe('regional scope', () => {
  test('regional officer cannot request another region by editing query parameters', async () => {
    const res = await s.regional.get('/api/dashboard/aicte/region?regionId=REGION-OTHER-DEMO');
    assert.equal(res.status, 403);
    const xyz = await Institution.findOne({ institutionCode: 'XYZ-DEMO' }).lean();
    assert.equal((await s.regional.get(`/api/dashboard/aicte/region?institutionId=${xyz._id}`)).status, 403);
    assert.equal((await s.regional.get(`/api/institutions/${xyz._id}/seat-ledger`)).status, 404);
  });

  test('regional dashboard only aggregates assigned regions', async () => {
    const res = await s.regional.get('/api/dashboard/aicte/region');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.scope.assignedRegions, ['REGION-DEMO']);
    assert.ok(res.body.filters.institutions.every((i) => i.regionId === 'REGION-DEMO'));
  });

  test('officer of an unrelated region cannot see the region\'s risk case or conflict', async () => {
    const risks = await s.regional.get('/api/risk-cases');
    assert.ok(risks.body.items.length >= 1);
    const id = risks.body.items[0].riskCaseId;
    assert.equal((await s.regionalEast.get(`/api/risk-cases/${id}`)).status, 404);
    const eastList = await s.regionalEast.get('/api/risk-cases');
    assert.equal(eastList.body.items.length, 0);
    const conflicts = await s.regional.get('/api/conflicts');
    assert.ok(conflicts.body.items.length >= 1);
    assert.equal((await s.regionalEast.get(`/api/conflicts/${conflicts.body.items[0].conflictId}`)).status, 404);
  });
});

describe('student and verifier privacy', () => {
  test('student cannot approve consent for another student', async () => {
    const other = await Enrolment.findOne({ studentRef: { $ne: s.student.user.studentRef } }).lean();
    const consent = await Consent.create({
      consentId: 'CNS-OTHERSTUDENT1', requestId: 'VRQ-OTHERSTUDENT1', studentRef: other.studentRef,
      verifierUserId: (await User.findOne({ role: 'VERIFIER' }).lean())._id,
      verifierOrgId: (await User.findOne({ role: 'VERIFIER' }).lean()).organisationId,
      purpose: 'EMPLOYMENT_VERIFICATION', requestedFields: ['displayName'], expiresAt: new Date(Date.now() + 86400000),
    });
    const res = await s.student.post(`/api/consents/${consent.consentId}/approve`, { approvedFields: ['displayName'] });
    assert.equal(res.status, 404);
    assert.equal((await Consent.findById(consent._id).lean()).status, 'PENDING');
  });

  test('student cannot edit the official record directly', async () => {
    const res = await s.student.patch('/api/students/me', { displayName: 'Changed' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'DIRECT_EDIT_FORBIDDEN');
  });

  test('issuer cannot open records outside its issuer scope', async () => {
    const xyz = await Institution.findOne({ institutionCode: 'XYZ-DEMO' }).lean();
    const outside = await Enrolment.findOne({ institutionId: xyz._id }).lean();
    assert.equal((await s.issuer.get(`/api/issuer/enrolments/${outside.enrolmentRef}`)).status, 404);
    const list = await s.issuer.get('/api/issuer/eligible-students?pageSize=100');
    assert.ok(list.body.items.every((item) => ['ABC-DEMO', 'PQR-DEMO'].includes(item.institutionCode)));
  });
});
