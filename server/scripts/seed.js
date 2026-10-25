// npm run seed [-- --reset-passwords] [-- --force]
// npm run seed:live (from the repository root) seeds the online demo database named in .env.live.
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
  const live = args.includes('--live');

  // --live must reach the online database from .env.live, never this computer's dev database,
  // and must use a chosen password so live passwords are never printed.
  if (live && (!config.mongodbUri || /[/@](localhost|127\.0\.0\.1)[:/]/.test(config.mongodbUri))) {
    console.error('seed:live needs the Atlas connection string as MONGODB_URI in .env.live. It refuses to use the database on this computer.');
    process.exit(1);
  }
  if (live && !process.env.DEMO_PASSWORD) {
    console.error('seed:live needs DEMO_PASSWORD in .env.live (the password for the live demo accounts).');
    process.exit(1);
  }

  await connectForScript();
  console.log(`Connected to database "${mongoose.connection.name}" on ${mongoose.connection.host}.`);

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
  const signInAt = live ? 'your live site (https://<service>.onrender.com/login)' : `${config.clientOrigin}/login`;
  console.log(`Sign in at ${signInAt}. Passwords are shown only in this terminal and are not stored anywhere in plain text.`);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('Seed failed:', error.message);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
