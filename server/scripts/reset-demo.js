// npm run demo:reset -- --confirm
// Development-only: DROPS the configured database and re-seeds the synthetic demo data.
// There is deliberately no HTTP endpoint for this (spec 10 section 8).
const mongoose = require('mongoose');
const { spawnSync } = require('child_process');
const path = require('path');
const { refuseInProduction, connectForScript, disconnectDatabase } = require('./lib/scriptDb');

async function main() {
  refuseInProduction('Demo reset');
  if (!process.argv.includes('--confirm')) {
    console.error('This deletes ALL data in the configured database. Re-run with: npm run demo:reset -- --confirm');
    process.exit(1);
  }
  await connectForScript();
  const name = mongoose.connection.name;
  if (!/(demo|dev|test|local)/i.test(name)) {
    console.error(`Refusing to drop database "${name}": its name must contain demo, dev, test or local.`);
    process.exit(1);
  }
  await mongoose.connection.dropDatabase();
  console.log(`Dropped database "${name}".`);
  await disconnectDatabase();
  const seed = spawnSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit', env: process.env });
  process.exit(seed.status || 0);
}

main().catch(async (error) => {
  console.error('Reset failed:', error.message);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
