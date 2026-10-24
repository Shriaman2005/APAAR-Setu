// MOCK identity adapter standing in for an APAAR-like external identity service.
//
// It NEVER contacts a real registry. Outcomes are deterministic so tests and demos are repeatable:
//   - identifiers listed in fixtures/mockIdentityRegistry.json      -> MATCHED or NAME_MISMATCH
//   - identifiers starting with "999" (registry_pending fixture)    -> PENDING (simulated timeout)
//   - any other well-formed identifier                              -> NOT_FOUND
//   - service switched to UNAVAILABLE in admin demo settings         -> PENDING for every row
//
// To integrate a real service later, implement the same checkIdentity() contract in a new adapter
// and select it in services/validation/l2Identity.js. Do not change callers.
const registry = require('./fixtures/mockIdentityRegistry.json').records;

const ADAPTER_NAME = 'MOCK_APAAR_IDENTITY_ADAPTER_v1';
const DEMO_ID_FORMAT = /^\d{12}$/; // synthetic demo format rule: exactly 12 digits

function normaliseName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * @param {{ externalId: string, studentName: string }} input
 * @param {{ serviceMode: 'AVAILABLE'|'UNAVAILABLE' }} options
 * @returns {{ status: 'MATCHED'|'NAME_MISMATCH'|'NOT_FOUND'|'PENDING', adapter: string, simulated: true, detail: string }}
 */
function checkIdentity({ externalId, studentName }, { serviceMode = 'AVAILABLE' } = {}) {
  if (serviceMode === 'UNAVAILABLE') {
    return { status: 'PENDING', adapter: ADAPTER_NAME, simulated: true, detail: 'SERVICE_UNAVAILABLE' };
  }
  if (externalId.startsWith('999')) {
    return { status: 'PENDING', adapter: ADAPTER_NAME, simulated: true, detail: 'SIMULATED_TIMEOUT' };
  }
  const registeredName = registry[externalId];
  if (!registeredName) {
    return { status: 'NOT_FOUND', adapter: ADAPTER_NAME, simulated: true, detail: 'NOT_IN_MOCK_REGISTRY' };
  }
  if (normaliseName(registeredName) !== normaliseName(studentName)) {
    return { status: 'NAME_MISMATCH', adapter: ADAPTER_NAME, simulated: true, detail: 'NAME_DIFFERS_FROM_MOCK_RECORD' };
  }
  return { status: 'MATCHED', adapter: ADAPTER_NAME, simulated: true, detail: 'MATCHED_MOCK_RECORD' };
}

module.exports = { ADAPTER_NAME, DEMO_ID_FORMAT, checkIdentity };
