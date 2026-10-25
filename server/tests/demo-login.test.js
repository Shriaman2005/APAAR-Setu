// One-click demo sign-in (prototype demos only, DEMO_LOGIN).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestApp, request } = require('./helpers/testApp');
const { createApp } = require('../src/app');
const { User, AuditLog } = require('../src/models');

let ctx;
before(async () => { ctx = await setupTestApp(); });
after(async () => { if (ctx) await ctx.cleanup(); });

async function demoSignIn(app, email) {
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/auth/csrf-token')).body.csrfToken;
  const response = await agent.post('/api/auth/demo-login').set('X-CSRF-Token', csrf).send({ email });
  return { agent, response };
}

test('lists the seeded demo accounts, one per role first, without ids', async () => {
  const res = await request(ctx.app).get('/api/auth/demo-accounts');
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true);
  const { accounts } = res.body;
  assert.equal(accounts.length, 11);
  assert.deepEqual(accounts.slice(0, 2).map((a) => a.email), ['operator.demo@example.test', 'operator.xyz.demo@example.test']);
  assert.deepEqual([...new Set(accounts.map((a) => a.role))], [
    'COLLEGE_OPERATOR', 'COLLEGE_HEAD', 'AICTE_NATIONAL_OFFICER', 'AICTE_REGIONAL_OFFICER',
    'AICTE_SYSTEM_ADMIN', 'DEGREE_AWARDING_BODY', 'VERIFIER', 'STUDENT',
  ]);
  assert.equal(accounts[0].scope, 'ABC Institute of Technology (Demo)');
  assert.equal(accounts.find((a) => a.role === 'AICTE_REGIONAL_OFFICER').scope, 'Demo Region North (synthetic)');
  for (const account of accounts) assert.deepEqual(Object.keys(account).sort(), ['email', 'role', 'scope']);
});

test('one click signs in with the account\'s normal role and permissions', async () => {
  const { agent, response } = await demoSignIn(ctx.app, 'operator.demo@example.test');
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.user.role, 'COLLEGE_OPERATOR');
  assert.ok(response.body.csrfToken);
  assert.equal((await agent.get('/api/auth/me')).body.user.email, 'operator.demo@example.test');
  assert.equal((await agent.get('/api/dashboard/college')).status, 200);
  assert.equal((await agent.get('/api/dashboard/admin')).status, 403);
});

test('needs the CSRF token like every other state-changing request', async () => {
  const res = await request(ctx.app).post('/api/auth/demo-login').send({ email: 'operator.demo@example.test' });
  assert.equal(res.status, 403);
});

test('is recorded in the audit trail as demo access', async () => {
  await demoSignIn(ctx.app, 'student.demo@example.test');
  const student = await User.findOne({ emailNormalized: 'student.demo@example.test' }).lean();
  const event = await AuditLog.findOne({ action: 'AUTH_LOGIN_SUCCEEDED', entityRef: String(student._id), 'payload.method': 'DEMO_ACCESS' }).lean();
  assert.ok(event, 'audit event for the demo sign-in');
});

test('refuses accounts that are not seeded demo accounts', async () => {
  await User.create({ emailNormalized: 'real.officer@example.test', displayName: 'Not a demo account', role: 'AICTE_NATIONAL_OFFICER', status: 'ACTIVE', isDemo: false });
  for (const email of ['real.officer@example.test', 'nobody@example.test']) {
    const { response } = await demoSignIn(ctx.app, email);
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'DEMO_ACCOUNT_NOT_FOUND');
  }
  const listed = (await request(ctx.app).get('/api/auth/demo-accounts')).body.accounts;
  assert.ok(!listed.some((a) => a.email === 'real.officer@example.test'));
});

test('switched off: nothing is listed and the sign-in route does not exist', async () => {
  const offApp = createApp({ ...ctx.config, demoLogin: false });
  const list = await request(offApp).get('/api/auth/demo-accounts');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, { enabled: false, accounts: [] });
  const { response } = await demoSignIn(offApp, 'operator.demo@example.test');
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
});
