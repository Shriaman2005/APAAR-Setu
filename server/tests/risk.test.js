// Rule-based risk queue (spec 04 sections 5-6, spec 07 L7). A risk score is never proof of fraud.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture, justifyAllAndCertify } = require('./helpers/testApp');
const { RiskCase, User } = require('../src/models');
const { hashPassword } = require('../src/services/authService');

let ctx;
const s = {};
let riskCaseId;

before(async () => {
  ctx = await setupTestApp();
  await User.create({ emailNormalized: 'regional.two@example.test', displayName: 'Second Regional Officer (test)', role: 'AICTE_REGIONAL_OFFICER', status: 'ACTIVE', regionIds: ['REGION-DEMO'], passwordHash: await hashPassword('Test-Password-2026'), isDemo: true });
  await User.create({ emailNormalized: 'regional.south@example.test', displayName: 'South Regional Officer (test)', role: 'AICTE_REGIONAL_OFFICER', status: 'ACTIVE', regionIds: ['REGION-OTHER-DEMO'], passwordHash: await hashPassword('Test-Password-2026'), isDemo: true });
  for (const [alias, email] of Object.entries({
    national: 'national.demo@example.test', regional: 'regional.demo@example.test', regionalTwo: 'regional.two@example.test',
    operator: 'operator.demo@example.test', head: 'head.demo@example.test',
  })) s[alias] = await loginAs(ctx.app, email);
  riskCaseId = (await RiskCase.findOne({ ruleCode: 'L7_SHARED_CONTACT' }).lean()).riskCaseId;
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('risk queue', () => {
  test('seeded shared-contact case shows score, reasons, evidence and ruleset version', async () => {
    const res = await s.national.get(`/api/risk-cases/${riskCaseId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.evidence.studentsSharing, 12);
    assert.equal(res.body.score, 90, '30 + 5 x 12');
    assert.equal(res.body.priority, 'HIGH');
    assert.equal(res.body.rulesetVersion, 'RISK-RULES-DEMO-v1');
    assert.ok(res.body.reasons.length >= 2);
    assert.match(res.body.notice, /not a probability of fraud/);
    assert.ok(res.body.evidence.maskedStudentRefs.every((ref) => ref.includes('…')), 'student refs masked');
    assert.ok(!JSON.stringify(res.body).includes('PHONE-DEMO-SHARED'), 'token masked');
  });

  test('assignment is restricted to officers inside the case scope', async () => {
    const assignees = (await s.regional.get(`/api/risk-cases/${riskCaseId}/assignees`)).body.items;
    assert.ok(assignees.every((a) => a.role === 'AICTE_REGIONAL_OFFICER' && a.regionIds.includes('REGION-DEMO')));
    const south = await User.findOne({ emailNormalized: 'regional.south@example.test' }).lean();
    const bad = await s.regional.post(`/api/risk-cases/${riskCaseId}/assign`, { assigneeId: String(south._id) });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error.code, 'ASSIGNEE_OUT_OF_SCOPE');
    const two = await User.findOne({ emailNormalized: 'regional.two@example.test' }).lean();
    const ok = await s.regional.post(`/api/risk-cases/${riskCaseId}/assign`, { assigneeId: String(two._id) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'ASSIGNED');
    const inbox = (await s.regionalTwo.get('/api/notifications')).body.items;
    assert.ok(inbox.some((n) => n.type === 'RISK_CASE_ASSIGNED'));
  });

  test('notes are appended; review requires a summary and does not imply wrongdoing', async () => {
    assert.equal((await s.regionalTwo.post(`/api/risk-cases/${riskCaseId}/notes`, { text: 'Called the institution; hostel office number shared.' })).status, 200);
    assert.equal((await s.regionalTwo.post(`/api/risk-cases/${riskCaseId}/review`, { summary: 'short' })).status, 422);
    const reviewed = await s.regionalTwo.post(`/api/risk-cases/${riskCaseId}/review`, { summary: 'Shared number belongs to the hostel office; no further action.' });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.status, 'REVIEWED');
    assert.equal(reviewed.body.notes.length, 1);
    assert.ok(reviewed.body.events.some((e) => /does not imply/.test(e.message)));
    assert.equal((await s.regional.post(`/api/risk-cases/${riskCaseId}/escalate`, { reason: 'Escalating a closed case should fail.' })).status, 409);
  });

  test('false positive keeps the original signal and evidence', async () => {
    const risky = await RiskCase.create({
      riskCaseId: 'RISK-TESTFP0001', institutionId: (await RiskCase.findOne().lean()).institutionId, regionId: 'REGION-DEMO', academicYear: '2026-27',
      signalKey: 'LATE_ADDITION', ruleCode: 'L7_LATE_ADDITION', rulesetVersion: 'RISK-RULES-DEMO-v1', score: 30, priority: 'LOW',
      reasons: ['1 late admission'], evidence: { lateAdmissions: 1 }, evidenceHistory: [{ evidence: { lateAdmissions: 1 }, score: 30, at: new Date() }],
    });
    assert.equal((await s.national.post(`/api/risk-cases/${risky.riskCaseId}/false-positive`, { reason: 'x' })).status, 422);
    const res = await s.national.post(`/api/risk-cases/${risky.riskCaseId}/false-positive`, { reason: 'Admission date was a data-entry typo, verified with college.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'FALSE_POSITIVE');
    const stored = await RiskCase.findById(risky._id).lean();
    assert.deepEqual(stored.evidence, { lateAdmissions: 1 });
    assert.equal(stored.evidenceHistory.length, 1);
    assert.deepEqual(stored.reasons, ['1 late admission']);
  });

  test('escalation notifies national officers', async () => {
    const open = await RiskCase.create({
      riskCaseId: 'RISK-TESTESC001', institutionId: (await RiskCase.findOne().lean()).institutionId, regionId: 'REGION-DEMO', academicYear: '2026-27',
      signalKey: 'ADDITIONAL_BUCKET_RATIO', ruleCode: 'L7_ADDITIONAL_BUCKET_RATIO', rulesetVersion: 'RISK-RULES-DEMO-v1', score: 50, priority: 'MEDIUM',
      reasons: ['test'], evidence: {},
    });
    const res = await s.regional.post(`/api/risk-cases/${open.riskCaseId}/escalate`, { reason: 'Needs a national-level look at the pattern.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ESCALATED');
    const inbox = (await s.national.get('/api/notifications')).body.items;
    assert.ok(inbox.some((n) => n.type === 'RISK_CASE_ESCALATED'));
  });

  test('college roles cannot read the risk queue', async () => {
    assert.equal((await s.operator.get('/api/risk-cases')).status, 403);
    assert.equal((await s.head.get(`/api/risk-cases/${riskCaseId}`)).status, 403);
  });

  test('a risk flag never blocks certification or penalises automatically', async () => {
    const { batchId } = await uploadFixture(s.operator, 'late.csv', { content: 'studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn\nSTU-332,Gaurav Iyer,CSE,2026-27,REGULAR,333333333332,PHONE-DEMO-Q,1,2026-10-05\n' });
    const res = await justifyAllAndCertify({ operator: s.operator, head: s.head, batchId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Post-commit rule evaluation creates a case for review - the enrolment itself stays CONFIRMED.
    const late = await RiskCase.findOne({ signalKey: 'LATE_ADDITION', ruleCode: 'L7_LATE_ADDITION', riskCaseId: { $ne: 'RISK-TESTFP0001' } }).lean();
    assert.ok(late, 'late-addition case created after commit');
    const { Enrolment } = require('../src/models');
    assert.equal((await Enrolment.findOne({ sourceBatchId: batchId }).lean()).state, 'CONFIRMED');
  });
});
