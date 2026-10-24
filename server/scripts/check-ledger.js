// npm run check:ledger
// Maintenance check: compares every seat-ledger counter with the enrolments holding seats.
const { connectForScript, disconnectDatabase } = require('./lib/scriptDb');
const { reconcileLedgers } = require('../src/services/seatLedgerService');

async function main() {
  await connectForScript();
  const result = await reconcileLedgers();
  console.log(`Checked ${result.checkedLedgers} ledger rows at ${result.checkedAt}.`);
  if (result.consistent) {
    console.log('All seat counters match the enrolments holding seats.');
  } else {
    console.log('MISMATCHES FOUND:');
    console.table(result.mismatches);
  }
  await disconnectDatabase();
  process.exit(result.consistent ? 0 : 1);
}

main().catch(async (error) => {
  console.error('Ledger check failed:', error.message);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
