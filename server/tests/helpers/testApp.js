// Test helpers: isolated database per test file, seeded synthetic data, and logged-in agents.
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const { buildConfig } = require('../../src/config/env');
const { connectDatabase } = require('../../src/config/db');
const { ensureDatabaseSetup } = require('../../src/models');
const { ensureAuditChainHead } = require('../../src/services/auditService');
const { createApp } = require('../../src/app');
const { runDemoSeed } = require('../../src/seed/demoSeed');

const TEST_PASSWORD = 'Test-Password-2026';
const FIXTURES = path.resolve(__dirname, '../../../fixtures');

/**
 * Connects to a fresh database (unique name per test file), prepares indexes and returns an app.
 * @param {object} options { seed: boolean, config: overrides passed to buildConfig }
 */
async function setupTestApp({ seed = true, config: overrides = {} } = {}) {
  const uri = process.env.TEST_MONGODB_URI;
  if (!uri) throw new Error('TEST_MONGODB_URI is not set. Run tests with "npm test".');
  const dbName = `test_${path.basename(process.argv[1] || 'x', '.test.js').replace(/[^a-z0-9]/gi, '_')}_${crypto.randomBytes(3).toString('hex')}`;
  await connectDatabase(uri, { dbName });
  try {
    await ensureDatabaseSetup();
    await ensureAuditChainHead();
    if (seed) await runDemoSeed({ passwordFor: () => TEST_PASSWORD });
  } catch (error) {
    // Close the connection so a failed setup cannot leave the test process hanging.
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    throw error;
  }
  const config = buildConfig({
    mongodbUri: uri,
    sessionSecret: process.env.SESSION_SECRET,
    validationMode: 'sync',
    logRequests: false,
    clientOrigin: 'http://localhost:5173',
    publicVerifyBaseUrl: 'http://localhost:5173',
    credentialRefSecret: 'test-credential-secret',
    ...overrides,
    rateLimits: { loginMaxFailures: 1000, publicVerifyMax: 1000, setPasswordMax: 1000, verificationRequestMax: 1000, ...(overrides.rateLimits || {}) },
  });
  const app = createApp(config);
  return {
    app,
    config,
    async cleanup() {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    },
  };
}

async function csrfFor(agent) {
  const response = await agent.get('/api/auth/csrf-token');
  assert.equal(response.status, 200);
  return response.body.csrfToken;
}

/**
 * Signs in and returns helpers that send the CSRF header automatically.
 */
async function loginAs(app, email, password = TEST_PASSWORD) {
  const agent = request.agent(app);
  const csrf = await csrfFor(agent);
  const response = await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  assert.equal(response.status, 200, `login failed for ${email}: ${JSON.stringify(response.body)}`);
  return wrapAgent(agent, response.body.csrfToken, response.body.user);
}

function wrapAgent(agent, token, user) {
  const session = {
    agent,
    user,
    token,
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('X-CSRF-Token', session.token).send(body),
    patch: (url, body = {}) => agent.patch(url).set('X-CSRF-Token', session.token).send(body),
    put: (url, body = {}) => agent.put(url).set('X-CSRF-Token', session.token).send(body),
    upload: (fileName, { content, academicYear = '2026-27', idempotencyKey, contentType = 'text/csv' } = {}) => {
      const buffer = content !== undefined ? Buffer.from(content) : fs.readFileSync(path.join(FIXTURES, fileName));
      const req = agent.post('/api/batches').set('X-CSRF-Token', session.token);
      if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
      return req.field('academicYear', academicYear).attach('file', buffer, { filename: fileName, contentType });
    },
  };
  return session;
}

// Uploads a fixture as the ABC-DEMO operator and returns { batchId, body }.
async function uploadFixture(operator, fileName, options) {
  const response = await operator.upload(fileName, options);
  assert.ok([200, 202].includes(response.status), `upload failed: ${JSON.stringify(response.body)}`);
  return { batchId: response.body.batchId, body: response.body };
}

async function currentIssues(session, batchId, query = '') {
  const response = await session.get(`/api/batches/${batchId}/issues?pageSize=100${query}`);
  assert.equal(response.status, 200);
  return response.body.items;
}

// Justifies every warning that needs it, marks ready, accepts as head and certifies.
async function justifyAllAndCertify({ operator, head, batchId }) {
  const issues = await currentIssues(operator, batchId);
  for (const issue of issues.filter((i) => i.dispositionRequired && i.resolutionStatus === 'OPEN')) {
    const res = await operator.post(`/api/batches/${batchId}/issues/${issue.id}/justify`, { justification: 'Checked against the admission file (synthetic test).' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  const ready = await operator.post(`/api/batches/${batchId}/mark-ready`, {});
  assert.equal(ready.status, 200, JSON.stringify(ready.body));
  const toAccept = (await currentIssues(head, batchId)).filter((i) => i.dispositionRequired && i.resolutionStatus === 'JUSTIFIED');
  if (toAccept.length) {
    const res = await head.post(`/api/batches/${batchId}/dispositions`, { issueIds: toAccept.map((i) => i.id), reason: 'Reviewed justification evidence (synthetic test).' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  return head.post(`/api/batches/${batchId}/certify`, { declarationAccepted: true, confirmBatchId: batchId });
}

module.exports = { setupTestApp, loginAs, wrapAgent, csrfFor, uploadFixture, currentIssues, justifyAllAndCertify, TEST_PASSWORD, FIXTURES, request };
