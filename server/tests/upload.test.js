// CSV upload and staging safety (spec 08 upload group, spec 04 upload wizard).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { Enrolment, Student, StagingRow, UploadBatch } = require('../src/models');

const HEADER = 'studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn';
let ctx;
let operator;

before(async () => {
  ctx = await setupTestApp();
  operator = await loginAs(ctx.app, 'operator.demo@example.test');
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('template', () => {
  test('template info lists columns, permitted values and the synthetic notice', async () => {
    const res = await operator.get('/api/batches/template-info');
    assert.equal(res.status, 200);
    assert.equal(res.body.columns.length, 9);
    const year = res.body.academicYears.find((y) => y.academicYear === '2026-27');
    assert.equal(year.sourceType, 'SYNTHETIC_DEMO_CONFIG');
    assert.deepEqual(year.courses.find((c) => c.courseCode === 'CSE').buckets, ['REGULAR', 'NRI', 'TFW', 'INTERNATIONAL']);
    assert.match(res.body.notice, /not an official AICTE template/i);
  });

  test('template CSV download contains only the header row', async () => {
    const res = await operator.get('/api/batches/template.csv');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.equal(res.text.trim(), HEADER);
  });
});

describe('file safety', () => {
  test('non-CSV extension is rejected with 415', async () => {
    const res = await operator.upload('students.txt', { content: `${HEADER}\n`, contentType: 'text/plain' });
    assert.equal(res.status, 415);
  });

  test('binary content renamed to .csv is rejected (extension alone is not trusted)', async () => {
    const res = await operator.upload('sheet.csv', { content: Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(50)]) });
    assert.equal(res.status, 415);
    assert.equal(res.body.error.code, 'FILE_CONTENT_NOT_CSV');
  });

  test('malformed CSV is rejected with a line reference', async () => {
    const res = await operator.upload('broken.csv', { content: `${HEADER}\nSTU-1,"Unclosed quote,CSE,2026-27,REGULAR,111111111111,,1,2026-08-01\n` });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'CSV_MALFORMED');
  });

  test('missing and unexpected columns are reported', async () => {
    const res = await operator.upload('cols.csv', { content: 'studentCode,studentName,institutionId\nSTU-1,A,X\n' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'CSV_HEADER_INVALID');
    assert.ok(res.body.error.details.missingColumns.includes('courseCode'));
    assert.deepEqual(res.body.error.details.unexpectedColumns, ['institutionId']);
  });

  test('header-only and empty files are rejected', async () => {
    assert.equal((await operator.upload('empty.csv', { content: '' })).status, 422);
    assert.equal((await operator.upload('header.csv', { content: `${HEADER}\n` })).body.error.code, 'CSV_NO_DATA_ROWS');
  });

  test('oversized file is rejected with 413', async () => {
    const small = createApp({ ...ctx.config, maxUploadMb: 1 });
    const agentOperator = await loginAs(small, 'operator.demo@example.test');
    const row = 'STU-001,Aarav Sharma,CSE,2026-27,REGULAR,111111111111,PHONE-DEMO-A,1,2026-08-01\n';
    const res = await agentOperator.upload('big.csv', { content: HEADER + '\n' + row.repeat(15000) });
    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'FILE_TOO_LARGE');
  });

  test('too many rows is rejected with 413', async () => {
    const limited = createApp({ ...ctx.config, maxRowsPerBatch: 2 });
    const agentOperator = await loginAs(limited, 'operator.demo@example.test');
    const res = await agentOperator.upload('clean_batch.csv');
    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'TOO_MANY_ROWS');
  });

  test('academic year without a published policy is rejected', async () => {
    const res = await operator.upload('clean_batch.csv', { academicYear: '2031-32' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NO_ACTIVE_POLICY_FOR_YEAR');
  });

  test('path tricks in the file name are neutralised', async () => {
    const res = await operator.upload('../../etc/passwd.csv', { content: `${HEADER}\nSTU-901,Riya Bhatt,CSE,2026-27,REGULAR,888888888803,PHONE-DEMO-Z,1,2026-08-01\n` });
    assert.equal(res.status, 202);
    const batch = await UploadBatch.findOne({ batchId: res.body.batchId }).lean();
    assert.equal(batch.sourceFileName, 'passwd.csv');
  });
});

describe('staging, duplicates and idempotency', () => {
  test('upload creates a batch and staged rows but no official records', async () => {
    const enrolmentsBefore = await Enrolment.countDocuments();
    const studentsBefore = await Student.countDocuments();
    const res = await operator.upload('clean_batch.csv');
    assert.equal(res.status, 202);
    assert.match(res.body.batchId, /^BATCH-ABC-DEMO-\d{8}-[0-9A-Z]{4}$/);
    assert.equal(res.body.receivedRows, 4);
    const rows = await StagingRow.find({ batchId: res.body.batchId }).sort({ rowNumber: 1 }).lean();
    assert.deepEqual(rows.map((r) => r.rowNumber), [2, 3, 4, 5], 'row 1 is the header');
    assert.equal(await Enrolment.countDocuments(), enrolmentsBefore, 'nothing written to the official register');
    assert.equal(await Student.countDocuments(), studentsBefore);
  });

  test('uploading the same file again is explicitly rejected', async () => {
    const res = await operator.upload('clean_batch.csv');
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_FILE');
    assert.ok(res.body.error.details.existingBatchId);
  });

  test('retrying with the same Idempotency-Key returns the original batch', async () => {
    const content = `${HEADER}\nSTU-902,Omkar Patil,CSE,2026-27,REGULAR,888888888804,PHONE-DEMO-Y,1,2026-08-02\n`;
    const first = await operator.upload('retry.csv', { content, idempotencyKey: 'retry-key-1' });
    const second = await operator.upload('retry.csv', { content, idempotencyKey: 'retry-key-1' });
    assert.equal(first.status, 202);
    assert.equal(second.status, 200);
    assert.equal(second.body.idempotentReplay, true);
    assert.equal(second.body.batchId, first.body.batchId);
    assert.equal(await UploadBatch.countDocuments({ idempotencyKey: 'retry-key-1' }), 1);
  });

  test('institution comes from the session, not from the file', async () => {
    const res = await operator.upload('clean_batch.csv', { content: `${HEADER}\nSTU-903,Tara Kapoor,IT,2026-27,REGULAR,666666666631,PHONE-DEMO-W,1,2026-08-03\n` });
    const batch = await UploadBatch.findOne({ batchId: res.body.batchId }).lean();
    assert.equal(String(batch.institutionId), String(operator.user.institution.id));
    const issues = await operator.get(`/api/batches/${res.body.batchId}/issues`);
    assert.ok(issues.body.items.some((i) => i.ruleCode === 'L1_INVALID_VALUE' && i.field === 'courseCode'), 'IT is not an ABC-DEMO course');
  });
});
