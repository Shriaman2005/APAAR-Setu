// Audit hash chain (spec 08 section 4 and audit test group).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, loginAs } = require('./helpers/testApp');
const { AuditLog } = require('../src/models');
const { recordAudit, verifyChain } = require('../src/services/auditService');

let ctx;
const s = {};

before(async () => {
  ctx = await setupTestApp();
  for (const [alias, email] of Object.entries({
    national: 'national.demo@example.test', admin: 'admin.demo@example.test', head: 'head.demo@example.test',
    headXyz: 'head.xyz.demo@example.test', operator: 'operator.demo@example.test', regional: 'regional.demo@example.test',
  })) s[alias] = await loginAs(ctx.app, email);
});
after(async () => { if (ctx) await ctx.cleanup(); });

describe('chain integrity', () => {
  test('a normal chain verifies as PASS and the check itself is recorded', async () => {
    const res = await s.national.post('/api/audit/verify-chain');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'PASS');
    assert.ok(res.body.checkedEvents > 10);
    assert.equal(res.body.firstFailureSequence, null);
    assert.match(res.body.guarantee, /does not prove/);
    assert.ok(await AuditLog.exists({ action: 'AUDIT_CHAIN_VERIFIED' }));
  });

  test('concurrent appends never share a sequence number', async () => {
    await Promise.all(Array.from({ length: 15 }, (_, i) => recordAudit({ actor: 'system', action: 'TEST_CONCURRENT_APPEND', entityType: 'Test', entityRef: `t-${i}` })));
    const sequences = (await AuditLog.find({}, { sequence: 1 }).lean()).map((e) => e.sequence);
    assert.equal(new Set(sequences).size, sequences.length);
    assert.equal((await verifyChain()).status, 'PASS');
  });

  test('modifying one stored event is detected at that sequence', async () => {
    const target = await AuditLog.findOne({ action: 'POLICY_PUBLISHED' }).lean();
    await AuditLog.collection.updateOne({ _id: target._id }, { $set: { reason: 'tampered reason' } });
    const res = await s.admin.post('/api/audit/verify-chain');
    assert.equal(res.body.status, 'FAIL');
    assert.equal(res.body.firstFailureSequence, target.sequence);
    assert.ok(res.body.failures.some((f) => f.problem === 'EVENT_HASH_MISMATCH'));
    await AuditLog.collection.updateOne({ _id: target._id }, { $set: { reason: target.reason } });
    assert.equal((await verifyChain()).status, 'PASS', 'restoring the original value passes again');
  });

  test('changing a payload or deleting an event is detected', async () => {
    const victim = await AuditLog.findOne({ action: 'AUTH_LOGIN_SUCCEEDED' }).lean();
    await AuditLog.collection.updateOne({ _id: victim._id }, { $set: { 'payload.injected': true } });
    let result = await verifyChain();
    assert.ok(result.failures.some((f) => f.sequence === victim.sequence && f.problem === 'PAYLOAD_HASH_MISMATCH'));
    await AuditLog.collection.replaceOne({ _id: victim._id }, victim);
    await AuditLog.collection.deleteOne({ _id: victim._id });
    result = await verifyChain();
    assert.equal(result.status, 'FAIL');
    assert.ok(result.failures.some((f) => f.problem === 'SEQUENCE_GAP' || f.problem === 'PREVIOUS_HASH_MISMATCH'));
    await AuditLog.collection.insertOne(victim);
    assert.equal((await verifyChain()).status, 'PASS');
  });

  test('application code cannot update or delete audit events', async () => {
    await assert.rejects(AuditLog.updateOne({}, { $set: { reason: 'x' } }), /append-only/);
    await assert.rejects(AuditLog.deleteMany({}), /append-only/);
    const existing = await AuditLog.findOne();
    existing.reason = 'changed';
    await assert.rejects(existing.save(), /append-only/);
  });
});

describe('access to audit data', () => {
  test('only authorised officers/admins can run verification', async () => {
    assert.equal((await s.head.post('/api/audit/verify-chain')).status, 403);
    assert.equal((await s.regional.post('/api/audit/verify-chain')).status, 403);
    assert.equal((await s.operator.get('/api/audit')).status, 403);
  });

  test('college head sees only own-institution events', async () => {
    const abc = (await s.head.get('/api/audit?pageSize=100')).body.items;
    const xyz = (await s.headXyz.get('/api/audit?pageSize=100')).body.items;
    assert.ok(abc.length > 0);
    const abcRefs = new Set(abc.map((e) => e.sequence));
    assert.ok(xyz.every((e) => !abcRefs.has(e.sequence)), 'no overlap between institutions');
    assert.ok(abc.every((e) => !e.entityRef.includes('XYZ-DEMO')));
  });

  test('national officer can filter by action', async () => {
    const res = await s.national.get('/api/audit?action=POLICY_PUBLISHED');
    assert.equal(res.status, 200);
    assert.ok(res.body.items.every((e) => e.action === 'POLICY_PUBLISHED'));
  });
});
