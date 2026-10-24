// Random, non-sequential public references. Sequential IDs would let someone
// guess other records (spec 08 section 3), so every public reference uses crypto randomness.
const crypto = require('crypto');

// Crockford-style base32 without easily confused characters (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomCode(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function todayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

module.exports = {
  randomCode,
  newBatchId: (institutionCode) => `BATCH-${institutionCode}-${todayStamp()}-${randomCode(4)}`,
  newStudentRef: () => `SR-${crypto.randomUUID()}`,
  newEnrolmentRef: () => `ENR-${randomCode(12)}`,
  newConflictId: () => `CONF-${randomCode(10)}`,
  newRiskCaseId: () => `RISK-${randomCode(10)}`,
  newConsentId: () => `CNS-${randomCode(12)}`,
  newRequestId: () => `VRQ-${randomCode(12)}`,
  newCorrectionRequestId: () => `CRQ-${randomCode(10)}`,
  newOneTimeToken: () => crypto.randomBytes(32).toString('base64url'),
};
