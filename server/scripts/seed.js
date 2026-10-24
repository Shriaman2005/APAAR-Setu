// npm run seed [-- --reset-passwords] [-- --force]
// Creates the synthetic demo data from /fixtures. Safe to re-run: existing demo records are kept,
// nothing is deleted, and scenario data is only created once.
const mongoose = require('mongoose');
const { refuseInProduction, connectForScript, disconnectDatabase, config } = require('./lib/scriptDb');
const { runDemoSeed, generatePassword } = require('../src/seed/demoSeed');
const { checkPasswordPolicy } = require('../src/services/authService');
const { User } = require('../src/models');

async function main() {
  refuseInProduction('Seed');
  const args = process.argv.slice(2);
  const resetPasswords = args.includes('--reset-passwords');
  const force = args.includes('--force');

  await connectForScript();
  console.log(`Connected to database "${mongoose.connection.name}".`);

  // Never add demo accounts with known passwords to a database that holds non-demo users.
  const realUsers = await User.countDocuments({ isDemo: { $ne: true } });
  if (realUsers > 0 && !force) {
    console.error(`Refusing to seed: the database contains ${realUsers} non-demo user account(s). Use a separate demo database, or pass --force if you are sure.`);
    process.exit(1);
  }

  const sharedPassword = process.env.DEMO_PASSWORD || '';
  if (sharedPassword) checkPasswordPolicy(sharedPassword, 'demo@example.test');
  const result = await runDemoSeed({ passwordFor: () => sharedPassword || generatePassword(), resetPasswords });

  console.log('\nSYNTHETIC DEMO DATA ONLY - development accounts, never use these in production.\n');
  console.log('Account'.padEnd(36), 'Role'.padEnd(26), 'Password');
  for (const user of result.users) {
    const shown = user.password ? (sharedPassword ? '(the DEMO_PASSWORD value you set)' : user.password) : '(unchanged - use --reset-passwords to set a new one)';
    console.log(user.email.padEnd(36), user.role.padEnd(26), shown);
  }
  console.log(`\nSeat policies: ${result.policiesCreated ? 'created DEMO-v1 (published) and DEMO-v2 (awaiting approval)' : 'already present'}.`);
  console.log(`Scenario data: ${result.scenarioCreated ? 'created (conflict STU-005, shared-contact risk case, stale-policy batch)' : 'already present (use "npm run demo:reset -- --confirm" for a fresh copy)'}.`);
  console.log(`Sign in at ${config.clientOrigin}/login. Passwords are shown only in this terminal and are not stored anywhere in plain text.`);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('Seed failed:', error.message);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
