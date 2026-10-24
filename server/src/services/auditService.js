// Hash-chained audit log (spec 06 auditLogs, spec 08 section 4).
//
// Each event stores:
//   eventPayloadHash = SHA-256(canonical JSON of the safe payload)
//   previousHash     = hash of the event before it (64 zeros for the first event)
//   hash             = SHA-256(canonical JSON of all event fields except `hash`)
// Changing any stored field breaks the recomputed hash, and removing/reordering events breaks the
// previousHash links. This DETECTS uncoordinated changes; it does not make the database immutable,
// because someone with full database access could rewrite every hash consistently.
const mongoose = require('mongoose');
const { AuditLog, AuditChainHead, User } = require('../models');
const { sha256Hex, canonicalJson } = require('../utils/hash');
const { dbState } = require('../config/db');
const { ROLES } = require('../config/constants');
const { readPagination, pageResult } = require('../utils/pagination');
const { forbidden } = require('../utils/AppError');

const GENESIS_HASH = '0'.repeat(64);
const CHAIN_ID = 'audit-chain';

// Only these fields are hashed, in this exact shape. Keep in sync with verifyChain().
function hashableFields(event) {
  return {
    sequence: event.sequence,
    timestamp: new Date(event.timestamp).toISOString(),
    actorRef: event.actorRef,
    actorRole: event.actorRole || null,
    action: event.action,
    entityType: event.entityType,
    entityRef: event.entityRef,
    institutionId: event.institutionId || null,
    regionIds: event.regionIds || [],
    reason: event.reason || null,
    eventPayloadHash: event.eventPayloadHash,
    previousHash: event.previousHash,
  };
}

function computeEventHash(event) {
  return sha256Hex(canonicalJson(hashableFields(event)));
}

function computePayloadHash(payload) {
  return sha256Hex(canonicalJson(payload || {}));
}

// Turns the caller's description of an event into the stored shape (without sequence/hashes).
function buildEventBase(input) {
  const actor = input.actor;
  let actorRef = 'system';
  let actorRole = 'SYSTEM';
  if (actor === 'anonymous') {
    actorRef = 'anonymous';
    actorRole = 'ANONYMOUS';
  } else if (actor && typeof actor === 'object') {
    actorRef = String(actor.id);
    actorRole = actor.role;
  }
  // JSON round-trip removes Dates/ObjectIds so the stored payload re-hashes identically when read back.
  const payload = JSON.parse(JSON.stringify(input.payload || {}));
  return {
    timestamp: new Date(),
    actorRef,
    actorRole,
    action: input.action,
    entityType: input.entityType,
    entityRef: String(input.entityRef),
    institutionId: input.institutionId ? String(input.institutionId) : null,
    regionIds: (input.regionIds || []).filter(Boolean).map(String),
    reason: input.reason ? String(input.reason).slice(0, 500) : null,
    payload,
    eventPayloadHash: computePayloadHash(payload),
  };
}

async function ensureAuditChainHead() {
  await AuditChainHead.updateOne(
    { _id: CHAIN_ID },
    { $setOnInsert: { sequence: 0, lastHash: GENESIS_HASH } },
    { upsert: true }
  );
}

// Appends using the caller's transaction session. A concurrent append in another transaction
// produces a write conflict on the chain head, and the transaction helper retries it.
async function appendWithinSession(base, session) {
  let head = await AuditChainHead.findById(CHAIN_ID).session(session);
  if (!head) {
    [head] = await AuditChainHead.create([{ _id: CHAIN_ID, sequence: 0, lastHash: GENESIS_HASH }], { session });
  }
  const event = { ...base, sequence: head.sequence + 1, previousHash: head.lastHash };
  event.hash = computeEventHash(event);
  const moved = await AuditChainHead.updateOne(
    { _id: CHAIN_ID, sequence: head.sequence },
    { $set: { sequence: event.sequence, lastHash: event.hash } },
    { session }
  );
  if (moved.modifiedCount !== 1) {
    const error = new Error('Audit chain head moved during append');
    error.errorLabels = ['TransientTransactionError'];
    throw error;
  }
  await AuditLog.create([event], { session });
  return event;
}

// Fallback for a standalone MongoDB (no transactions): compare-and-swap on the chain head.
// If the process stopped between the two writes, verifyChain() would report a sequence gap.
async function appendWithCompareAndSwap(base) {
  await ensureAuditChainHead();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const head = await AuditChainHead.findById(CHAIN_ID).lean();
    const event = { ...base, sequence: head.sequence + 1, previousHash: head.lastHash };
    event.hash = computeEventHash(event);
    const moved = await AuditChainHead.updateOne(
      { _id: CHAIN_ID, sequence: head.sequence },
      { $set: { sequence: event.sequence, lastHash: event.hash } }
    );
    if (moved.modifiedCount === 1) {
      await AuditLog.create(event);
      return event;
    }
  }
  throw new Error('Could not append audit event after repeated contention.');
}

/**
 * Records an audit event.
 * @param {object} input { actor, action, entityType, entityRef, institutionId?, regionIds?, reason?, payload? }
 * @param {object} [options] { session } - pass the transaction session when inside a transaction
 */
async function recordAudit(input, options = {}) {
  const base = buildEventBase(input);
  if (options.session) return appendWithinSession(base, options.session);
  if (dbState.transactionsSupported) {
    let event;
    await mongoose.connection.transaction(async (session) => {
      event = await appendWithinSession({ ...base, timestamp: new Date() }, session);
    });
    return event;
  }
  return appendWithCompareAndSwap(base);
}

/**
 * Recomputes every hash and link. Returns PASS only if every event was actually checked.
 */
async function verifyChain() {
  const startedAt = Date.now();
  const failures = [];
  let expectedPrevious = GENESIS_HASH;
  let expectedSequence = 1;
  let checkedEvents = 0;
  let lastEvent = null;

  const cursor = AuditLog.find().sort({ sequence: 1 }).lean().cursor();
  for await (const event of cursor) {
    checkedEvents += 1;
    if (event.sequence !== expectedSequence) {
      failures.push({
        sequence: event.sequence,
        problem: 'SEQUENCE_GAP',
        detail: `Expected sequence ${expectedSequence} but found ${event.sequence}.`,
      });
    }
    if (computePayloadHash(event.payload) !== event.eventPayloadHash) {
      failures.push({ sequence: event.sequence, problem: 'PAYLOAD_HASH_MISMATCH', detail: 'Stored payload does not match its hash.' });
    }
    if (event.previousHash !== expectedPrevious) {
      failures.push({
        sequence: event.sequence,
        problem: 'PREVIOUS_HASH_MISMATCH',
        detail: 'Link to the previous event is broken (an event was changed, removed or reordered).',
      });
    }
    if (computeEventHash(event) !== event.hash) {
      failures.push({ sequence: event.sequence, problem: 'EVENT_HASH_MISMATCH', detail: 'Event fields do not match the stored hash.' });
    }
    expectedPrevious = event.hash;
    expectedSequence = event.sequence + 1;
    lastEvent = event;
  }

  const head = await AuditChainHead.findById(CHAIN_ID).lean();
  if (head && lastEvent && (head.sequence !== lastEvent.sequence || head.lastHash !== lastEvent.hash)) {
    failures.push({
      sequence: head.sequence,
      problem: 'CHAIN_HEAD_MISMATCH',
      detail: 'The recorded chain head does not match the last stored event (events may have been removed).',
    });
  }
  if (head && !lastEvent && head.sequence > 0) {
    failures.push({ sequence: head.sequence, problem: 'CHAIN_HEAD_MISMATCH', detail: 'Chain head exists but no events were found.' });
  }

  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    checkedEvents,
    headSequence: head ? head.sequence : 0,
    firstFailureSequence: failures.length > 0 ? failures[0].sequence : null,
    failureCount: failures.length,
    failures: failures.slice(0, 25),
    verifiedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    guarantee:
      'Detects uncoordinated changes to stored audit events. It does not prove the database was never ' +
      'rewritten by someone able to recompute every hash; production use needs separately protected checkpoints.',
  };
}

// Which audit events a role may read.
function auditScopeFilter(user) {
  switch (user.role) {
    case ROLES.AICTE_SYSTEM_ADMIN:
    case ROLES.AICTE_NATIONAL_OFFICER:
      return {};
    case ROLES.AICTE_REGIONAL_OFFICER:
      return { regionIds: { $in: user.regionIds } };
    case ROLES.COLLEGE_HEAD:
      return { institutionId: String(user.institutionId) };
    default:
      throw forbidden('Your role cannot read the audit log.');
  }
}

async function listAuditEvents(user, query) {
  const filter = auditScopeFilter(user);
  if (typeof query.action === 'string' && /^[A-Z_]{3,60}$/.test(query.action)) filter.action = query.action;
  if (typeof query.entityType === 'string' && /^[A-Za-z]{3,40}$/.test(query.entityType)) filter.entityType = query.entityType;
  if (typeof query.entityRef === 'string' && query.entityRef.length <= 80) filter.entityRef = query.entityRef.trim();
  const pagination = readPagination(query);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ sequence: -1 }).skip(pagination.skip).limit(pagination.pageSize).lean(),
    AuditLog.countDocuments(filter),
  ]);
  const actorIds = [...new Set(items.map((item) => item.actorRef).filter((ref) => mongoose.isValidObjectId(ref)))];
  const actors = await User.find({ _id: { $in: actorIds } }, { displayName: 1, role: 1 }).lean();
  const actorNames = new Map(actors.map((actor) => [String(actor._id), actor.displayName]));
  return pageResult(
    items.map((item) => ({
      sequence: item.sequence,
      timestamp: item.timestamp,
      actorRef: item.actorRef,
      actorName: actorNames.get(item.actorRef) || (item.actorRef === 'system' ? 'System' : 'Anonymous'),
      actorRole: item.actorRole,
      action: item.action,
      entityType: item.entityType,
      entityRef: item.entityRef,
      reason: item.reason,
      payload: item.payload,
      hash: item.hash,
      previousHash: item.previousHash,
    })),
    total,
    pagination
  );
}

// Timeline of one entity (e.g. a batch), already scope-checked by the caller.
async function entityTimeline(entityType, entityRef, limit = 100) {
  const events = await AuditLog.find({ entityType, entityRef }).sort({ sequence: 1 }).limit(limit).lean();
  const actorIds = [...new Set(events.map((event) => event.actorRef).filter((ref) => mongoose.isValidObjectId(ref)))];
  const actors = await User.find({ _id: { $in: actorIds } }, { displayName: 1 }).lean();
  const names = new Map(actors.map((actor) => [String(actor._id), actor.displayName]));
  return events.map((event) => ({
    sequence: event.sequence,
    timestamp: event.timestamp,
    action: event.action,
    actorName: names.get(event.actorRef) || event.actorRef,
    actorRole: event.actorRole,
    reason: event.reason,
    payload: event.payload,
  }));
}

module.exports = {
  GENESIS_HASH,
  recordAudit,
  verifyChain,
  listAuditEvents,
  entityTimeline,
  ensureAuditChainHead,
  computeEventHash,
  computePayloadHash,
};
