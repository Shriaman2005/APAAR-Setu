// MOCK DigiLocker adapter. Real DigiLocker issuance needs registered issuer credentials and a
// reviewed integration, which this prototype does not have. This adapter only records a SIMULATED
// outcome so the UI can show where a real push would happen. It never sends data anywhere.
const ADAPTER_NAME = 'MOCK_DIGILOCKER_ADAPTER_v1';

function simulatePush({ credentialRef }) {
  return {
    status: 'SIMULATED_NOT_SENT',
    adapter: ADAPTER_NAME,
    simulated: true,
    at: new Date(),
    note: `Credential ${credentialRef.slice(0, 8)}… was NOT sent to DigiLocker. Prototype mock only.`,
  };
}

module.exports = { ADAPTER_NAME, simulatePush };
