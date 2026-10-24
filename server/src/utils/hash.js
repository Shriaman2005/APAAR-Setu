// Hashing helpers used by the audit chain, file fingerprints and one-time tokens.
const crypto = require('crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Deterministic JSON: object keys are sorted at every level so the same data
 * always produces the same string (and therefore the same hash).
 * Dates become ISO strings; undefined values are dropped (like JSON.stringify).
 */
function canonicalJson(value) {
  return JSON.stringify(normalise(value));
}

function normalise(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : normalise(item)));
  if (typeof value === 'object') {
    // ObjectId and similar values serialise to their string form.
    if (typeof value.toHexString === 'function') return value.toHexString();
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) sorted[key] = normalise(value[key]);
    }
    return sorted;
  }
  return value;
}

// Constant-time comparison for secrets/checksums of equal length.
function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

module.exports = { sha256Hex, canonicalJson, safeEqual };
