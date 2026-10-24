// Spec 03 section 8 "Mandatory auth tests" and spec 08 auth group.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { setupTestApp, loginAs, csrfFor, TEST_PASSWORD, request } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { User } = require('../src/models');

let ctx;
before(async () => { ctx = await setupTestApp(); });
after(async () => { if (ctx) await ctx.cleanup(); });

async function attemptLogin(app, email, password) {
  const agent = request.agent(app);
  const csrf = await csrfFor(agent);
  return agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
}

describe('login', () => {
  test('valid login succeeds and never returns secrets', async () => {
    const res = await attemptLogin(ctx.app, 'operator.demo@example.test', TEST_PASSWORD);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'COLLEGE_OPERATOR');
    assert.equal(res.body.user.institution.code, 'ABC-DEMO');
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('passwordHash') && !text.includes('$2b$'), 'no password hash in response');
    assert.ok(res.headers['set-cookie'].some((c) => c.startsWith('apaar.sid=') && /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c)));
  });

  test('email is normalised (case and spaces)', async () => {
    const res = await attemptLogin(ctx.app, '  OPERATOR.Demo@Example.TEST ', TEST_PASSWORD);
    assert.equal(res.status, 200);
  });

  test('wrong password and unknown user fail identically (no account enumeration)', async () => {
    const wrong = await attemptLogin(ctx.app, 'operator.demo@example.test', 'Wrong-Password-1');
    const unknown = await attemptLogin(ctx.app, 'nobody@example.test', 'Wrong-Password-1');
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(wrong.body.error.code, unknown.body.error.code);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  test('missing fields return a field-level validation error', async () => {
    const res = await attemptLogin(ctx.app, '', '');
    assert.equal(res.status, 422);
    assert.ok(res.body.error.details.fieldErrors.email);
  });

  test('self-service role selection is rejected', async () => {
    const agent = request.agent(ctx.app);
    const csrf = await csrfFor(agent);
    const res = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'operator.demo@example.test', password: TEST_PASSWORD, role: 'AICTE_SYSTEM_ADMIN' });
    assert.equal(res.status, 422);
  });
});

describe('protected endpoints', () => {
  test('unauthenticated access returns 401', async () => {
    const res = await request(ctx.app).get('/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');
    const batches = await request(ctx.app).get('/api/batches');
    assert.equal(batches.status, 401);
  });

  test('authenticated user without permission receives 403', async () => {
    const student = await loginAs(ctx.app, 'student.demo@example.test');
    const res = await student.get('/api/batches');
    assert.equal(res.status, 403);
  });

  test('error responses never contain stack traces', async () => {
    const res = await request(ctx.app).get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.ok(!JSON.stringify(res.body).includes('at '), 'no stack trace');
  });
});

describe('sessions', () => {
  test('logout invalidates the server-side session and is idempotent', async () => {
    const operator = await loginAs(ctx.app, 'operator.demo@example.test');
    assert.equal((await operator.get('/api/auth/me')).status, 200);
    const out = await operator.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.equal((await operator.get('/api/auth/me')).status, 401);
    // Second logout still succeeds (needs a fresh CSRF token because the session was destroyed).
    const csrf = await csrfFor(operator.agent);
    const again = await operator.agent.post('/api/auth/logout').set('X-CSRF-Token', csrf);
    assert.equal(again.status, 200);
  });

  test('disabled user is rejected even with an existing session cookie', async () => {
    const verifier = await loginAs(ctx.app, 'verifier.demo@example.test');
    assert.equal((await verifier.get('/api/auth/me')).status, 200);
    const admin = await loginAs(ctx.app, 'admin.demo@example.test');
    const target = await User.findOne({ emailNormalized: 'verifier.demo@example.test' }).lean();
    const disabled = await admin.post(`/api/admin/users/${target._id}/disable`, { reason: 'Synthetic test of account disablement' });
    assert.equal(disabled.status, 200);
    const me = await verifier.get('/api/auth/me');
    assert.equal(me.status, 401);
    assert.equal(me.body.error.code, 'SESSION_REVOKED');
    const relogin = await attemptLogin(ctx.app, 'verifier.demo@example.test', TEST_PASSWORD);
    assert.equal(relogin.status, 401);
    await admin.post(`/api/admin/users/${target._id}/enable`, { reason: 'Re-enable after synthetic test' });
    assert.equal((await attemptLogin(ctx.app, 'verifier.demo@example.test', TEST_PASSWORD)).status, 200);
  });

  test('expired session is rejected', async () => {
    const shortApp = createApp({ ...ctx.config, sessionMaxAgeMs: 1000 });
    const national = await loginAs(shortApp, 'national.demo@example.test');
    assert.equal((await national.get('/api/auth/me')).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.equal((await national.get('/api/auth/me')).status, 401);
  });

  test('session id is rotated on login (session fixation protection)', async () => {
    const agent = request.agent(ctx.app);
    const first = await agent.get('/api/auth/csrf-token');
    const before = first.headers['set-cookie'][0].split(';')[0];
    const login = await agent.post('/api/auth/login').set('X-CSRF-Token', first.body.csrfToken).send({ email: 'national.demo@example.test', password: TEST_PASSWORD });
    const afterCookie = login.headers['set-cookie'][0].split(';')[0];
    assert.notEqual(before, afterCookie);
  });
});

describe('CSRF and throttling', () => {
  test('state-changing request without CSRF token is rejected', async () => {
    const operator = await loginAs(ctx.app, 'operator.demo@example.test');
    const res = await operator.agent.post('/api/notifications/read-all');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'CSRF_TOKEN_INVALID');
    const wrong = await operator.agent.post('/api/notifications/read-all').set('X-CSRF-Token', 'not-the-token');
    assert.equal(wrong.status, 403);
    const right = await operator.post('/api/notifications/read-all');
    assert.equal(right.status, 200);
  });

  test('login is throttled after repeated failures', async () => {
    const throttled = createApp({ ...ctx.config, rateLimits: { ...ctx.config.rateLimits, loginMaxFailures: 3 } });
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await attemptLogin(throttled, 'admin.demo@example.test', 'Wrong-Password-9')).status);
    assert.deepEqual(statuses, [401, 401, 401, 429]);
  });
});

describe('passwords', () => {
  test('change password enforces policy, rotates session and invalidates other sessions', async () => {
    const first = await loginAs(ctx.app, 'issuer.demo@example.test');
    const second = await loginAs(ctx.app, 'issuer.demo@example.test');
    const weak = await first.post('/api/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'short' });
    assert.equal(weak.status, 422);
    const wrongCurrent = await first.post('/api/auth/change-password', { currentPassword: 'Nope-12345678', newPassword: 'Another-Password-77' });
    assert.equal(wrongCurrent.status, 422);
    const ok = await first.post('/api/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'Another-Password-77' });
    assert.equal(ok.status, 200);
    first.token = ok.body.csrfToken;
    assert.equal((await first.get('/api/auth/me')).status, 200, 'current session continues');
    assert.equal((await second.get('/api/auth/me')).status, 401, 'other session invalidated');
    assert.equal((await attemptLogin(ctx.app, 'issuer.demo@example.test', TEST_PASSWORD)).status, 401);
    assert.equal((await attemptLogin(ctx.app, 'issuer.demo@example.test', 'Another-Password-77')).status, 200);
  });

  test('passwords are stored only as bcrypt hashes', async () => {
    const user = await User.findOne({ emailNormalized: 'head.demo@example.test' }).select('+passwordHash').lean();
    assert.match(user.passwordHash, /^\$2[aby]\$/);
    assert.notEqual(user.passwordHash, TEST_PASSWORD);
  });

  test('admin-initiated reset uses a one-time link and never reveals the old password', async () => {
    const admin = await loginAs(ctx.app, 'admin.demo@example.test');
    const target = await User.findOne({ emailNormalized: 'head.xyz.demo@example.test' }).lean();
    const reset = await admin.post(`/api/admin/users/${target._id}/password-reset`);
    assert.equal(reset.status, 200);
    assert.ok(!JSON.stringify(reset.body).includes(TEST_PASSWORD));
    const token = new URL(reset.body.resetLink).searchParams.get('token');
    assert.equal((await attemptLogin(ctx.app, 'head.xyz.demo@example.test', TEST_PASSWORD)).status, 401, 'old password stops working');
    const agent = request.agent(ctx.app);
    const csrf = await csrfFor(agent);
    const set = await agent.post('/api/auth/set-password').set('X-CSRF-Token', csrf).send({ token, newPassword: 'Fresh-Password-55' });
    assert.equal(set.status, 200);
    const reuse = await agent.post('/api/auth/set-password').set('X-CSRF-Token', csrf).send({ token, newPassword: 'Fresh-Password-56' });
    assert.equal(reuse.status, 422, 'token is single-use');
    assert.equal((await attemptLogin(ctx.app, 'head.xyz.demo@example.test', 'Fresh-Password-55')).status, 200);
    const stored = await User.findById(target._id).select('+oneTimeToken').lean();
    assert.equal(stored.oneTimeToken, undefined);
  });

  test('mongoose stays connected', () => {
    assert.equal(mongoose.connection.readyState, 1);
  });
});
