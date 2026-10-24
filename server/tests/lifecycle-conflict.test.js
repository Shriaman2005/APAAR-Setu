// Enrolment lifecycle and cross-college conflict workflow (spec 07 sections 7-9, spec 05 section 4).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs, uploadFixture, justifyAllAndCertify } = require('./helpers/testApp');
const { Enrolment, SeatLedger, Conflict, Student, Institution } = require('../src/models');
const { reconcileLedgers } = require('../src/services/seatLedgerService');

const HEADER = 'studentCode,studentName,courseCode,academicYear,bucketCode,externalIdDemo,contactToken,yearOfStudy,admittedOn';
let ctx;
const s = {};

before(async () => {
  ctx = await setupTestApp();
  for (const [alias, email] of Object.entries({
    operator: 'operator.demo@example.test', head: 'head.demo@example.test', operatorXyz: 'operator.xyz.demo@example.test',
    headXyz: 'head.xyz.demo@example.test', regional: 'regional.demo@example.test', national: 'national.demo@example.test',
  })) s[alias] = await loginAs(ctx.app, email);
});
after(async () => { if (ctx) await ctx.cleanup(); });

async function seededConflict() {
  const stu005 = await Student.findOne({ studentCode: 'STU-005' }).lean();
  return Conflict.findOne({ studentRef: stu005.studentRef }).lean();
}

describe('enrolment lifecycle', () => {
  test('withdrawal releases the seat exactly once and keeps history', async () => {
    const abc = await Institution.findOne({ institutionCode: 'ABC-DEMO' }).lean();
    const enrolment = await Enrolment.findOne({ institutionId: abc._id, courseCode: 'ECE', state: 'CONFIRMED' }).lean();
    const ledgerBefore = await SeatLedger.findOne({ courseId: enrolment.courseId, academicYear: enrolment.academicYear, bucketCode: enrolment.bucketCode }).lean();
    const res = await s.head.patch(`/api/enrolments/${enrolment.enrolmentRef}/state`, { toState: 'WITHDRAWN', reason: 'Student withdrew admission (synthetic test).' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.seatEffect, 'RELEASE');
    const again = await s.head.patch(`/api/enrolments/${enrolment.enrolmentRef}/state`, { toState: 'WITHDRAWN', reason: 'Trying to release the seat twice.' });
    assert.equal(again.status, 409);
    const ledgerAfter = await SeatLedger.findById(ledgerBefore._id).lean();
    assert.equal(ledgerAfter.filled, ledgerBefore.filled - 1, 'released once');
    const updated = await Enrolment.findById(enrolment._id).lean();
    assert.equal(updated.seatHeld, false);
    assert.deepEqual(updated.history.map((h) => h.toState), ['CONFIRMED', 'WITHDRAWN'], 'history preserved');
    assert.equal((await reconcileLedgers()).consistent, true);
  });

  test('invalid transitions and non-head actors are rejected', async () => {
    const abc = await Institution.findOne({ institutionCode: 'ABC-DEMO' }).lean();
    const enrolment = await Enrolment.findOne({ institutionId: abc._id, courseCode: 'ECE', state: 'CONFIRMED' }).lean();
    assert.equal((await s.head.patch(`/api/enrolments/${enrolment.enrolmentRef}/state`, { toState: 'PROVISIONAL', reason: 'Backwards transition attempt.' })).status, 409);
    assert.equal((await s.operator.patch(`/api/enrolments/${enrolment.enrolmentRef}/state`, { toState: 'WITHDRAWN', reason: 'Operator is not allowed to do this.' })).status, 403);
    assert.equal((await s.head.patch(`/api/enrolments/${enrolment.enrolmentRef}/state`, { toState: 'GRADUATED', reason: 'Unknown state value here.' })).status, 422);
  });
});

describe('conflict cases', () => {
  test('seeded STU-005 conflict is visible to both colleges with minimum detail of the other side', async () => {
    const conflict = await seededConflict();
    assert.equal(conflict.status, 'OPEN');
    const abcView = (await s.head.get(`/api/conflicts/${conflict.conflictId}`)).body;
    const other = abcView.sides.find((side) => !side.isOwnSide);
    const own = abcView.sides.find((side) => side.isOwnSide);
    assert.equal(other.institutionCode, 'XYZ-DEMO');
    assert.equal(other.courseCode, undefined, 'other institution course is hidden');
    assert.equal(other.enrolmentRef, undefined);
    assert.ok(own.courseCode && own.enrolmentRef);
    assert.match(abcView.notice, /not a finding of fraud/);
    const xyzView = (await s.headXyz.get(`/api/conflicts/${conflict.conflictId}`)).body;
    assert.equal(xyzView.sides.find((side) => side.isOwnSide).institutionCode, 'XYZ-DEMO');
  });

  test('national and regional lists mask student identifiers', async () => {
    const list = (await s.national.get('/api/conflicts')).body.items;
    assert.ok(list.length >= 1);
    assert.ok(list.every((item) => item.studentRefMasked.includes('…') && !item.studentRef));
    const detail = (await s.regional.get(`/api/conflicts/${list[0].conflictId}`)).body;
    assert.equal(detail.student.displayName, undefined);
    assert.ok(detail.student.initials);
  });

  test('operator submits facts; the other college sees only that a response exists', async () => {
    const conflict = await seededConflict();
    const res = await s.operatorXyz.post(`/api/conflicts/${conflict.conflictId}/resolve`, { action: 'SUBMIT_FACTS', reason: 'Student produced a transfer certificate dated 2026-08-18.' });
    assert.equal(res.status, 200);
    const abcView = (await s.head.get(`/api/conflicts/${conflict.conflictId}`)).body;
    const response = abcView.events.find((e) => e.type === 'INSTITUTION_RESPONSE');
    assert.equal(response.actorName, 'Other institution');
    assert.doesNotMatch(response.message, /transfer certificate/);
    const officerView = (await s.regional.get(`/api/conflicts/${conflict.conflictId}`)).body;
    assert.match(officerView.events.find((e) => e.type === 'INSTITUTION_RESPONSE').message, /transfer certificate/);
  });

  test('operator cannot withdraw; officers cannot change enrolments directly', async () => {
    const conflict = await seededConflict();
    assert.equal((await s.operator.post(`/api/conflicts/${conflict.conflictId}/resolve`, { action: 'WITHDRAW_OWN_ENROLMENT', reason: 'Operator attempting head action.' })).status, 403);
    assert.equal((await s.regional.post(`/api/conflicts/${conflict.conflictId}/resolve`, { action: 'WITHDRAW_OWN_ENROLMENT', reason: 'Officer attempting college action.' })).status, 403);
  });

  test('justification -> regional review: reject reopens, escalation is recorded once', async () => {
    const conflict = await seededConflict();
    const justify = await s.head.post(`/api/conflicts/${conflict.conflictId}/resolve`, { action: 'SUBMIT_JUSTIFICATION', reason: 'Student holds a provisional seat pending transfer confirmation.' });
    assert.equal(justify.status, 200);
    assert.equal(justify.body.status, 'AWAITING_REVIEW');
    const reject = await s.regional.post(`/api/conflicts/${conflict.conflictId}/resolve`, { action: 'REJECT_JUSTIFICATION', reason: 'Two active seats cannot both be justified here.' });
    assert.equal(reject.status, 200);
    assert.equal(reject.body.status, 'OPEN');
    const escalate = await s.regional.post(`/api/conflicts/${conflict.conflictId}/escalate`, { reason: 'Unresolved after institutional responses.' });
    assert.equal(escalate.status, 200);
    assert.equal(escalate.body.escalationLevel, 'NATIONAL');
    assert.equal((await s.national.post(`/api/conflicts/${conflict.conflictId}/escalate`, { reason: 'Escalating a second time.' })).status, 409);
  });

  test('transfer by the source college resolves the case, releases its seat and records the destination', async () => {
    const conflict = await seededConflict();
    const xyz = await Institution.findOne({ institutionCode: 'XYZ-DEMO' }).lean();
    const xyzEnrolment = await Enrolment.findOne({ studentRef: conflict.studentRef, institutionId: xyz._id }).lean();
    const ledgerBefore = await SeatLedger.findOne({ courseId: xyzEnrolment.courseId, academicYear: '2026-27', bucketCode: xyzEnrolment.bucketCode }).lean();
    const res = await s.headXyz.post(`/api/conflicts/${conflict.conflictId}/resolve`, { action: 'TRANSFER_OWN_ENROLMENT', reason: 'Student transferred to ABC Institute of Technology.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'RESOLVED');
    assert.equal(res.body.resolution.type, 'TRANSFERRED');
    const moved = await Enrolment.findById(xyzEnrolment._id).lean();
    assert.equal(moved.state, 'TRANSFERRED');
    assert.ok(moved.transferDestination.enrolmentRef);
    assert.equal((await SeatLedger.findById(ledgerBefore._id).lean()).filled, ledgerBefore.filled - 1);
    const double = await s.head.post(`/api/conflicts/${conflict.conflictId}/resolve`, { action: 'WITHDRAW_OWN_ENROLMENT', reason: 'Second resolution attempt.' });
    assert.equal(double.status, 409);
    assert.equal(double.body.error.code, 'CONFLICT_ALREADY_RESOLVED');
    assert.equal((await reconcileLedgers()).consistent, true);
  });

  test('committing a student active elsewhere opens a new conflict case after justification', async () => {
    const { batchId } = await uploadFixture(s.operator, 'l5.csv', { content: `${HEADER}\nSTU-021,Ishita Rao,CSE,2026-27,REGULAR,666666666621,PHONE-DEMO-X1,1,2026-08-14\n` });
    const res = await justifyAllAndCertify({ operator: s.operator, head: s.head, batchId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.commitSummary.conflictsCreated, 1);
    const stu021 = await Student.findOne({ studentCode: 'STU-021' }).lean();
    const created = await Conflict.findOne({ studentRef: stu021.studentRef, isOpen: true }).lean();
    assert.equal(created.detectedBy, 'COMMIT_DETECTOR');
    assert.equal(created.enrolmentRefs.length, 2);
    const notified = (await s.headXyz.get('/api/notifications')).body.items;
    assert.ok(notified.some((n) => n.type === 'CONFLICT_CASE'));
  });

  test('accepted justification closes a case with both enrolments still active', async () => {
    const stu021 = await Student.findOne({ studentCode: 'STU-021' }).lean();
    const open = await Conflict.findOne({ studentRef: stu021.studentRef, isOpen: true }).lean();
    await s.headXyz.post(`/api/conflicts/${open.conflictId}/resolve`, { action: 'SUBMIT_JUSTIFICATION', reason: 'Approved dual-programme arrangement (synthetic scenario).' });
    const regionalOther = await s.national.post(`/api/conflicts/${open.conflictId}/resolve`, { action: 'ACCEPT_JUSTIFICATION', reason: 'Documentation reviewed (synthetic test).' });
    assert.equal(regionalOther.status, 200);
    assert.equal(regionalOther.body.status, 'RESOLVED');
    assert.equal(regionalOther.body.resolution.type, 'JUSTIFIED');
    assert.equal(await Enrolment.countDocuments({ studentRef: stu021.studentRef, seatHeld: true }), 2);
  });
});
