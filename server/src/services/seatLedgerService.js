// Seat ledger reads, atomic reserve/release and reconciliation.
// Capacity always comes from the published (synthetic) seat policy; nothing is hard-coded.
const mongoose = require('mongoose');
const { SeatLedger, Enrolment, Institution, Course } = require('../models');
const { ROLES, SEAT_OCCUPYING_STATES } = require('../config/constants');
const { forbidden, notFound } = require('../utils/AppError');

class CapacityError extends Error {
  constructor(details) {
    super('Seat capacity is insufficient');
    this.name = 'CapacityError';
    this.details = details;
  }
}

/**
 * Atomically reserves `count` seats. The filter only matches when filled + count <= capacity,
 * so two concurrent commits can never both take the last seat (the loser matches nothing).
 */
async function reserveSeats({ courseId, academicYear, bucketCode, count }, session) {
  const ledger = await SeatLedger.findOneAndUpdate(
    {
      courseId,
      academicYear,
      bucketCode,
      inActivePolicy: true,
      $expr: { $lte: [{ $add: ['$filled', count] }, '$capacity'] },
    },
    { $inc: { filled: count } },
    { session, returnDocument: 'after' }
  ).lean();
  if (!ledger) {
    const current = await SeatLedger.findOne({ courseId, academicYear, bucketCode }).session(session).lean();
    throw new CapacityError({
      bucketCode,
      requested: count,
      capacity: current ? current.capacity : null,
      filled: current ? current.filled : null,
      reason: current ? (current.inActivePolicy ? 'INSUFFICIENT_CAPACITY' : 'BUCKET_NOT_IN_ACTIVE_POLICY') : 'NO_LEDGER',
    });
  }
  return ledger;
}

// Releases one seat. Never lets the counter go below zero.
async function releaseSeat({ courseId, academicYear, bucketCode }, session) {
  const ledger = await SeatLedger.findOneAndUpdate(
    { courseId, academicYear, bucketCode, filled: { $gte: 1 } },
    { $inc: { filled: -1 } },
    { session, returnDocument: 'after' }
  ).lean();
  if (!ledger) {
    const error = new Error('Seat ledger counter would become negative; reconciliation needed.');
    error.code = 'LEDGER_INCONSISTENT';
    throw error;
  }
  return ledger;
}

function presentLedger(ledger, coursesById) {
  const course = coursesById.get(String(ledger.courseId));
  return {
    courseCode: ledger.courseCode,
    programName: course ? course.programName : ledger.courseCode,
    approvedIntake: course ? course.approvedIntake : null,
    bucketCode: ledger.bucketCode,
    capacity: ledger.capacity,
    filled: ledger.filled,
    remaining: ledger.capacity - ledger.filled,
    countsWithinIntake: ledger.countsWithinIntake,
    policyVersion: ledger.policyVersion,
    sourceType: ledger.sourceType,
    inActivePolicy: ledger.inActivePolicy,
    updatedAt: ledger.updatedAt,
  };
}

// Throws 404/403 unless the user may see this institution's ledger.
async function assertInstitutionVisible(user, institution) {
  switch (user.role) {
    case ROLES.COLLEGE_OPERATOR:
    case ROLES.COLLEGE_HEAD:
      if (String(user.institutionId) !== String(institution._id)) throw notFound('Institution not found.');
      return;
    case ROLES.AICTE_REGIONAL_OFFICER:
      if (!user.regionIds.includes(institution.regionId)) throw notFound('Institution not found.');
      return;
    case ROLES.AICTE_NATIONAL_OFFICER:
    case ROLES.AICTE_SYSTEM_ADMIN:
      return;
    default:
      throw forbidden('Your role cannot view seat ledgers.');
  }
}

async function findInstitution(idOrCode) {
  if (typeof idOrCode !== 'string' || idOrCode.length > 60) return null;
  if (mongoose.isValidObjectId(idOrCode)) return Institution.findById(idOrCode).lean();
  return Institution.findOne({ institutionCode: idOrCode.toUpperCase() }).lean();
}

async function getInstitutionLedger(user, institutionIdOrCode, academicYear) {
  const institution = await findInstitution(institutionIdOrCode);
  if (!institution) throw notFound('Institution not found.');
  await assertInstitutionVisible(user, institution);
  const filter = { institutionId: institution._id };
  if (academicYear) filter.academicYear = academicYear;
  const [ledgers, courses] = await Promise.all([
    SeatLedger.find(filter).sort({ academicYear: -1, courseCode: 1, bucketCode: 1 }).lean(),
    Course.find({ institutionId: institution._id }).lean(),
  ]);
  const coursesById = new Map(courses.map((course) => [String(course._id), course]));
  return {
    institution: { id: String(institution._id), code: institution.institutionCode, name: institution.name, regionId: institution.regionId },
    academicYear: academicYear || null,
    buckets: ledgers.map((ledger) => presentLedger(ledger, coursesById)),
    note: 'Capacities are SYNTHETIC demo configuration from the published seat policy, not official AICTE quotas.',
  };
}

/**
 * Compares every ledger counter with the number of seat-holding enrolments.
 * Used by tests, the admin "ledger check" page and `npm run check:ledger`.
 */
async function reconcileLedgers(filter = {}) {
  const [ledgers, counts] = await Promise.all([
    SeatLedger.find(filter).lean(),
    Enrolment.aggregate([
      { $match: { ...filter, seatHeld: true, state: { $in: SEAT_OCCUPYING_STATES } } },
      { $group: { _id: { courseId: '$courseId', academicYear: '$academicYear', bucketCode: '$bucketCode' }, count: { $sum: 1 } } },
    ]),
  ]);
  const actual = new Map(counts.map((item) => [`${item._id.courseId}|${item._id.academicYear}|${item._id.bucketCode}`, item.count]));
  const mismatches = [];
  for (const ledger of ledgers) {
    const key = `${ledger.courseId}|${ledger.academicYear}|${ledger.bucketCode}`;
    const occupied = actual.get(key) || 0;
    if (occupied !== ledger.filled || ledger.filled > ledger.capacity || ledger.filled < 0) {
      mismatches.push({
        courseCode: ledger.courseCode, academicYear: ledger.academicYear, bucketCode: ledger.bucketCode,
        ledgerFilled: ledger.filled, enrolmentsHoldingSeats: occupied, capacity: ledger.capacity,
      });
    }
    actual.delete(key);
  }
  for (const [key, occupied] of actual) {
    const [courseId, academicYear, bucketCode] = key.split('|');
    mismatches.push({ courseId, academicYear, bucketCode, ledgerFilled: null, enrolmentsHoldingSeats: occupied, capacity: null });
  }
  return { checkedLedgers: ledgers.length, consistent: mismatches.length === 0, mismatches, checkedAt: new Date().toISOString() };
}

module.exports = { CapacityError, reserveSeats, releaseSeat, getInstitutionLedger, reconcileLedgers, assertInstitutionVisible, findInstitution };
