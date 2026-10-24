// npm test
// Starts ONE throw-away MongoDB replica set (real mongod binary via mongodb-memory-server), then runs
// every *.test.js file with Node's built-in test runner. Each test file uses its own database, so
// tests never touch development or demo data. Set TEST_MONGODB_URI to reuse an existing replica set.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

async function main() {
  let replSet = null;
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger', args: ['--wiredTigerCacheSizeGB', '0.25'] },
    });
    uri = replSet.getUri();
  }

  const testDir = __dirname;
  const filter = process.argv[2];
  const files = fs.readdirSync(testDir)
    .filter((name) => name.endsWith('.test.js') && (!filter || name.includes(filter)))
    .sort()
    .map((name) => path.join(testDir, name));

  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-force-exit', '--test-reporter=spec', ...files], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TEST_MONGODB_URI: uri,
      BCRYPT_ROUNDS: '4',
      VALIDATION_MODE: 'sync',
      SESSION_SECRET: 'test-session-secret-that-is-long-enough-1234567890',
      CREDENTIAL_REF_SECRET: 'test-credential-secret',
    },
  });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  if (replSet) await replSet.stop();
  process.exit(code);
}

main().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
