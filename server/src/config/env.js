// Loads and validates environment configuration in one place.
// Every other file should read settings from this module, never from process.env directly.
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

// The .env file lives at the repository root (one level above /server).
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

function readInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer.`);
  }
  return value;
}

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes'].includes(String(raw).toLowerCase());
}

/**
 * Builds the configuration object. Tests call this with overrides so they can
 * use small limits (for example a tiny login rate limit) without editing .env.
 */
function buildConfig(overrides = {}) {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const sessionSecret = process.env.SESSION_SECRET || '';
  const config = {
    nodeEnv,
    isProduction,
    isTest: nodeEnv === 'test',
    port: readInt('PORT', 5000),
    mongodbUri: process.env.MONGODB_URI || '',
    sessionSecret,
    sessionMaxAgeMs: readInt('SESSION_MAX_AGE_MS', 60 * 60 * 1000),
    clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    publicVerifyBaseUrl: process.env.PUBLIC_VERIFY_BASE_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    maxUploadMb: readInt('MAX_UPLOAD_MB', 5),
    maxRowsPerBatch: readInt('MAX_ROWS_PER_BATCH', 10000),
    trustProxy: readInt('TRUST_PROXY', 0),
    serveClient: readBool('SERVE_CLIENT', isProduction),
    // Separate key for the keyed checksum inside credential references.
    // Falls back to a value derived from SESSION_SECRET so local setup needs one secret only.
    credentialRefSecret:
      process.env.CREDENTIAL_REF_SECRET ||
      crypto.createHash('sha256').update(`credential-ref:${sessionSecret}`).digest('hex'),
    rateLimits: {
      loginWindowMs: 15 * 60 * 1000,
      loginMaxFailures: readInt('LOGIN_MAX_FAILURES', 20),
      publicVerifyWindowMs: 60 * 1000,
      publicVerifyMax: readInt('PUBLIC_VERIFY_MAX_PER_MINUTE', 60),
      setPasswordWindowMs: 15 * 60 * 1000,
      setPasswordMax: 10,
      verificationRequestWindowMs: 60 * 60 * 1000,
      verificationRequestMax: 30,
    },
    logRequests: readBool('LOG_REQUESTS', nodeEnv !== 'test'),
    sessionCookieName: 'apaar.sid',
    // Secure cookies need HTTPS. On by default in production; override with COOKIE_SECURE.
    cookieSecure: readBool('COOKIE_SECURE', isProduction),
    // 'async' = validation runs in the background after the upload response (default);
    // 'sync'  = the request waits for validation (used by automated tests).
    validationMode: process.env.VALIDATION_MODE === 'sync' ? 'sync' : 'async',
  };

  // Overrides replace top-level settings; rate limits are merged so a test can change just one.
  const { rateLimits: rateLimitOverrides, ...otherOverrides } = overrides;
  return {
    ...config,
    ...otherOverrides,
    rateLimits: { ...config.rateLimits, ...(rateLimitOverrides || {}) },
  };
}

function validateConfig(config) {
  const problems = [];
  if (!config.mongodbUri) problems.push('MONGODB_URI is required (see .env.example).');
  if (!config.sessionSecret) problems.push('SESSION_SECRET is required (see .env.example).');
  if (config.isProduction && config.sessionSecret.length < 32) {
    problems.push('SESSION_SECRET must be at least 32 characters in production.');
  }
  if (config.maxUploadMb < 1 || config.maxUploadMb > 50) problems.push('MAX_UPLOAD_MB must be between 1 and 50.');
  if (config.maxRowsPerBatch < 1) problems.push('MAX_ROWS_PER_BATCH must be at least 1.');
  if (problems.length > 0) {
    const error = new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    error.code = 'CONFIG_INVALID';
    throw error;
  }
  return config;
}

const config = buildConfig();

module.exports = { config, buildConfig, validateConfig };
