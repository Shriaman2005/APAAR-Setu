// Correction and revalidation (spec 04 issues grid, spec 07 "Correction made").
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture, currentIssues } = require('./helpers/testApp');
const { StagingRow, ValidationIssue } = require('../src/models');

let ctx;
let operator;
let head;

before(async () => {
  ctx = await setupTestApp();
  operator = await loginAs(ctx.app, 'operator.demo@example.test');
  head = await loginAs(ctx.app, 'head.demo@example.test');
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('correcting a row', () => {
  let batchId;
  before(async () => { ({ batchId } = await uploadFixture(operator, 'missing_required_field.csv')); });

  test('only allowed fields can be edited', async () => {
    const res = await operator.patch(`/api/batches/${batchId}/rows/2`, { changes: { rowNumber: '9', validationStatus: 'VALID' } });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'FIELD_NOT_EDITABLE');
  });

  test('saving a correction marks the row stale and keeps the original upload snapshot', async () => {
    const res = await operator.patch(`/api/batches/${batchId}/rows/2`, { changes: { courseCode: 'cse' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.changedFields, ['courseCode']);
    const row = await StagingRow.findOne({ batchId, rowNumber: 2 }).lean();
    assert.equal(row.fields.courseCode, 'CSE', 'normalised to upper case');
    assert.equal(row.rawSafeFields.courseCode, '', 'original value preserved');
    assert.equal(row.corrections.length, 1);
    assert.notEqual(row.rowVersion, row.validatedRowVersion);
    const detail = (await operator.get(`/api/batches/${batchId}`)).body;
    assert.equal(detail.batch.counts.staleRows, 1);
    assert.ok(detail.readiness.markReadyBlockers.some((b) => b.code === 'STALE_ROWS'), 'stale results cannot unlock the next step');
  });

  test('saving with no actual change is rejected', async () => {
    const res = await operator.patch(`/api/batches/${batchId}/rows/2`, { changes: { courseCode: 'CSE' } });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NO_CHANGES');
  });

  test('revalidation resolves fixed issues and keeps the history', async () => {
    await operator.patch(`/api/batches/${batchId}/rows/3`, { changes: { studentName: 'Rishi Verma' } });
    const res = await operator.post(`/api/batches/${batchId}/revalidate`);
    assert.equal(res.status, 202);
    const issues = await currentIssues(operator, batchId);
    assert.equal(issues.filter((i) => i.severity === 'ERROR').length, 0);
    const history = await ValidationIssue.find({ batchId, current: false }).lean();
    assert.ok(history.some((i) => i.ruleCode === 'L1_REQUIRED_FIELD' && i.resolutionStatus === 'RESOLVED'), 'previous outcome kept as RESOLVED');
    const detail = (await operator.get(`/api/batches/${batchId}`)).body;
    assert.equal(detail.batch.status, 'VALIDATED');
    assert.equal(detail.batch.counts.staleRows, 0);
    const rowDetail = (await operator.get(`/api/batches/${batchId}/rows/2`)).body;
    assert.ok(rowDetail.issueHistory.length >= 1, 'before/after results are visible');
  });
});

describe('excluding rows', () => {
  test('excluding one duplicate row resolves the duplicate after revalidation', async () => {
    const { batchId } = await uploadFixture(operator, 'duplicate_in_batch.csv');
    const noReason = await operator.post(`/api/batches/${batchId}/rows/4/exclude`, { reason: 'short' });
    assert.equal(noReason.status, 422, 'a reason of at least 10 characters is required');
    const excluded = await operator.post(`/api/batches/${batchId}/rows/4/exclude`, { reason: 'Duplicate of row 2 (same student)' });
    assert.equal(excluded.status, 200);
    await operator.post(`/api/batches/${batchId}/revalidate`);
    const issues = await currentIssues(operator, batchId);
    assert.equal(issues.filter((i) => i.ruleCode === 'L3_DUPLICATE_IN_BATCH').length, 0);
    const detail = (await operator.get(`/api/batches/${batchId}`)).body;
    assert.equal(detail.batch.counts.excludedRows, 1);
    assert.equal(detail.batch.status, 'VALIDATED');
    const include = await operator.post(`/api/batches/${batchId}/rows/4/include`);
    assert.equal(include.status, 200);
  });
});

describe('justification and state rules', () => {
  test('errors cannot be justified; warnings can; mark-ready requires justifications', async () => {
    const { batchId } = await uploadFixture(operator, 'warnings_demo.csv');
    const issues = await currentIssues(operator, batchId);
    const warning = issues.find((i) => i.ruleCode === 'L2_MOCK_NAME_MISMATCH');
    const blocked = await operator.post(`/api/batches/${batchId}/mark-ready`, {});
    assert.equal(blocked.status, 409);
    assert.ok(blocked.body.error.details.blockers.some((b) => b.code === 'JUSTIFICATIONS_MISSING'));
    const risk = issues.find((i) => i.severity === 'RISK_FLAG');
    const notAllowed = await operator.post(`/api/batches/${batchId}/issues/${risk.id}/justify`, { justification: 'Risk flags need no justification' });
    assert.equal(notAllowed.status, 422);
    const ok = await operator.post(`/api/batches/${batchId}/issues/${warning.id}/justify`, { justification: 'Name on admission form is the full surname.' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.resolutionStatus, 'JUSTIFIED');
  });

  test('rows cannot be edited once the batch is ready for review', async () => {
    const content = 'studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn\nSTU-601,Asha Kumar,CSE,2026-27,REGULAR,100000000001,PHONE-DEMO-RR,1,2026-08-02\n';
    const { batchId } = await uploadFixture(operator, 'ready.csv', { content });
    assert.equal((await operator.post(`/api/batches/${batchId}/mark-ready`, {})).status, 200);
    const edit = await operator.patch(`/api/batches/${batchId}/rows/2`, { changes: { studentName: 'Someone Else' } });
    assert.equal(edit.status, 409);
    assert.equal(edit.body.error.code, 'BATCH_NOT_EDITABLE');
    const twice = await operator.post(`/api/batches/${batchId}/mark-ready`, {});
    assert.equal(twice.status, 409, 'double submit is rejected');
  });

  test('head returns a batch with a reason; operator can correct again', async () => {
    const content = 'studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn\nSTU-602,Bhavna Joshi,CSE,2026-27,REGULAR,100000000002,PHONE-DEMO-RT,1,2026-08-02\n';
    const { batchId } = await uploadFixture(operator, 'return.csv', { content });
    await operator.post(`/api/batches/${batchId}/mark-ready`, {});
    assert.equal((await head.post(`/api/batches/${batchId}/return`, { reason: 'x' })).status, 422);
    const returned = await head.post(`/api/batches/${batchId}/return`, { reason: 'Please re-check the admission date.' });
    assert.equal(returned.status, 200);
    assert.equal(returned.body.status, 'RETURNED_FOR_CORRECTION');
    const detail = (await operator.get(`/api/batches/${batchId}`)).body;
    assert.equal(detail.batch.returnInfo.reason, 'Please re-check the admission date.');
    assert.equal(detail.permissions.canEditRows, true);
    const notifications = (await operator.get('/api/notifications')).body.items;
    assert.ok(notifications.some((n) => n.type === 'BATCH_RETURNED'));
  });

  test('operator can discard a staged batch; discarded batches are terminal', async () => {
    const { batchId } = await uploadFixture(operator, 'bad_mock_external_id.csv');
    const res = await operator.post(`/api/batches/${batchId}/discard`, { reason: 'Uploaded the wrong file by mistake.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'DISCARDED');
    assert.equal((await operator.post(`/api/batches/${batchId}/revalidate`)).status, 409);
  });
});
