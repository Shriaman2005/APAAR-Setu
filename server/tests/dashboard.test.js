// Dashboards and reports are computed from persisted data (no hard-coded metrics).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs } = require('./helpers/testApp');
const { Enrolment, Institution, SeatLedger } = require('../src/models');

let ctx;
const s = {};

before(async () => {
  ctx = await setupTestApp();
  for (const [alias, email] of Object.entries({
    operator: 'operator.demo@example.test', head: 'head.demo@example.test', national: 'national.demo@example.test', regional: 'regional.demo@example.test',
    admin: 'admin.demo@example.test', issuer: 'issuer.demo@example.test', verifier: 'verifier.demo@example.test', student: 'student.demo@example.test',
  })) s[alias] = await loginAs(ctx.app, email);
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('dashboards match the database', () => {
  test('college dashboard counts equal the stored enrolments and ledger', async () => {
    const res = await s.head.get('/api/dashboard/college');
    assert.equal(res.status, 200);
    assert.equal(res.body.dataLabel, 'SYNTHETIC DEMO DATA');
    const abc = await Institution.findOne({ institutionCode: 'ABC-DEMO' }).lean();
    const active = await Enrolment.countDocuments({ institutionId: abc._id, seatHeld: true });
    assert.equal(res.body.kpis.activeEnrolments, active);
    const ledgers = await SeatLedger.find({ institutionId: abc._id, inActivePolicy: true }).lean();
    assert.equal(res.body.kpis.seatCapacity, ledgers.reduce((sum, l) => sum + l.capacity, 0));
    assert.equal(res.body.kpis.batchesAwaitingReview, 1, 'seeded stale-policy batch awaits review');
    assert.equal(res.body.kpis.openConflicts, 1);
  });

  test('national dashboard aggregates all regions and drills down', async () => {
    const res = await s.national.get('/api/dashboard/aicte/national');
    assert.equal(res.status, 200);
    assert.equal(res.body.breakdown.level, 'REGION');
    assert.equal(res.body.kpis.activeEnrolments, await Enrolment.countDocuments({ seatHeld: true }));
    assert.equal(res.body.kpis.openConflicts, 1);
    assert.ok(res.body.kpis.openRiskCases >= 1);
    const region = await s.national.get('/api/dashboard/aicte/national?regionId=REGION-DEMO');
    assert.equal(region.body.breakdown.level, 'INSTITUTION');
    const abc = await Institution.findOne({ institutionCode: 'ABC-DEMO' }).lean();
    const course = await s.national.get(`/api/dashboard/aicte/national?institutionId=${abc._id}`);
    assert.equal(course.body.breakdown.level, 'COURSE');
    assert.ok(course.body.breakdown.rows.some((row) => row.key === 'CSE'));
  });

  test('regional dashboard is restricted to REGION-DEMO', async () => {
    const res = await s.regional.get('/api/dashboard/aicte/region');
    const pqrAbc = await Institution.find({ regionId: 'REGION-DEMO' }).lean();
    assert.equal(res.body.kpis.institutions, pqrAbc.length);
    assert.equal(res.body.kpis.activeEnrolments, await Enrolment.countDocuments({ regionId: 'REGION-DEMO', seatHeld: true }));
  });

  test('admin, issuer, verifier and student dashboards respond with real data', async () => {
    const admin = (await s.admin.get('/api/dashboard/admin')).body;
    assert.equal(admin.ledgerReconciliation.consistent, true);
    assert.equal(admin.usersByRole.STUDENT, 1);
    const issuer = (await s.issuer.get('/api/dashboard/issuer')).body;
    assert.deepEqual(issuer.affiliatedInstitutions.map((i) => i.code).sort(), ['ABC-DEMO', 'PQR-DEMO']);
    assert.equal((await s.verifier.get('/api/dashboard/verifier')).status, 200);
    assert.equal((await s.student.get('/api/dashboard/student')).body.enrolments, 0, 'STU-001 has no enrolment until the clean batch is certified');
  });
});

describe('reports', () => {
  test('national CSV report is aggregated, labelled DEMO and contains no names', async () => {
    const res = await s.national.get('/api/reports/national.csv?academicYear=2026-27');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /DEMO/);
    assert.ok(res.text.includes('SYNTHETIC DEMO DATA'));
    assert.ok(!res.text.includes('Rohan Mehta') && !res.text.includes('STU-'));
    assert.equal(res.text.trim().split('\n').length, 1 + (await Institution.countDocuments()));
  });

  test('regional report only includes assigned-region institutions', async () => {
    const res = await s.regional.get('/api/reports/region.csv');
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('XYZ-DEMO') && !res.text.includes('LMN-DEMO'));
    assert.ok(res.text.includes('ABC-DEMO') && res.text.includes('PQR-DEMO'));
    assert.equal((await s.regional.get('/api/reports/national.csv')).status, 403);
  });

  test('CSV exports neutralise spreadsheet formulas in user-entered text', async () => {
    const { escapeCell } = require('../src/utils/csvExport');
    assert.equal(escapeCell('=1+2'), "'=1+2");
    assert.equal(escapeCell('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(escapeCell('plain text'), 'plain text');
    // Operator justification text (user input) lands at the start of a CSV cell in the export.
    const content = 'studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn\nSTU-881,Asha Kumari,CSE,2026-27,REGULAR,100000000001,PHONE-DEMO-Z1,1,2026-08-02\n';
    const upload = await s.operator.upload('inject.csv', { content });
    assert.equal(upload.status, 202, JSON.stringify(upload.body));
    const issue = (await s.operator.get(`/api/batches/${upload.body.batchId}/issues`)).body.items.find((i) => i.ruleCode === 'L2_MOCK_NAME_MISMATCH');
    await s.operator.post(`/api/batches/${upload.body.batchId}/issues/${issue.id}/justify`, { justification: '=HYPERLINK(1) injected formula text' });
    const res = await s.operator.get(`/api/batches/${upload.body.batchId}/issues.csv`);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("'=HYPERLINK(1)"), 'formula is prefixed with a quote');
    assert.ok(!/(^|,)=HYPERLINK/m.test(res.text));
  });
});
