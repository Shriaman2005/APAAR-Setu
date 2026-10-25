// Configuration defaults that matter when deploying (no database needed).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildConfig } = require('../src/config/env');

const KEYS = ['CLIENT_ORIGIN', 'PUBLIC_VERIFY_BASE_URL', 'RENDER_EXTERNAL_URL'];

// Builds a config with only the given origin variables set, then restores process.env.
function configWith(values) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  const apply = (source) => {
    for (const key of KEYS) {
      if (source[key] === undefined) delete process.env[key];
      else process.env[key] = source[key];
    }
  };
  apply(values);
  try {
    return buildConfig();
  } finally {
    apply(saved);
  }
}

test('public address defaults to the local Vite dev server', () => {
  const config = configWith({});
  assert.equal(config.clientOrigin, 'http://localhost:5173');
  assert.equal(config.publicVerifyBaseUrl, 'http://localhost:5173');
});

test('on Render the public address comes from RENDER_EXTERNAL_URL', () => {
  const config = configWith({ RENDER_EXTERNAL_URL: 'https://apaar-setu.onrender.com' });
  assert.equal(config.clientOrigin, 'https://apaar-setu.onrender.com');
  assert.equal(config.publicVerifyBaseUrl, 'https://apaar-setu.onrender.com');
});

test('CLIENT_ORIGIN and PUBLIC_VERIFY_BASE_URL override the Render value', () => {
  const config = configWith({
    RENDER_EXTERNAL_URL: 'https://apaar-setu.onrender.com',
    CLIENT_ORIGIN: 'https://apaar.example.test',
    PUBLIC_VERIFY_BASE_URL: 'https://verify.example.test',
  });
  assert.equal(config.clientOrigin, 'https://apaar.example.test');
  assert.equal(config.publicVerifyBaseUrl, 'https://verify.example.test');
});
