// npm run db:dev
// Starts a LOCAL single-node MongoDB replica set for development, so multi-document transactions
// work (spec 02 section 6). It uses the MongoDB server binary downloaded by the
// mongodb-memory-server dev dependency, so no separate MongoDB installation is required.
// Data is kept in <repo>/.data/mongodb between runs. Press Ctrl+C to stop.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { MongoBinary } = require('mongodb-memory-server');

const { MongoClient } = mongoose.mongo;

const PORT = Number.parseInt(process.env.DEV_DB_PORT || '27017', 10);
const REPLICA_SET = 'rs0';
const DATA_DIR = path.resolve(__dirname, '../../.data/mongodb');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initiateReplicaSet() {
  const client = new MongoClient(`mongodb://127.0.0.1:${PORT}/?directConnection=true`, { serverSelectionTimeoutMS: 2000 });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await client.connect();
      break;
    } catch {
      await wait(500);
    }
  }
  const admin = client.db('admin');
  try {
    await admin.command({ replSetInitiate: { _id: REPLICA_SET, members: [{ _id: 0, host: `127.0.0.1:${PORT}` }] } });
    console.log('Replica set initiated.');
  } catch (error) {
    if (error.codeName !== 'AlreadyInitialized') throw error;
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary) break;
    await wait(500);
  }
  await client.close();
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const binary = await MongoBinary.getPath();
  console.log(`Starting MongoDB (${path.basename(binary)}) on port ${PORT}, data in ${DATA_DIR}`);
  const mongod = spawn(binary, [
    '--replSet', REPLICA_SET,
    '--port', String(PORT),
    '--bind_ip', '127.0.0.1',
    '--dbpath', DATA_DIR,
    '--wiredTigerCacheSizeGB', '0.25',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  mongod.on('exit', (code) => {
    console.log(`MongoDB stopped (exit code ${code}).`);
    process.exit(code || 0);
  });
  const stop = () => {
    console.log('\nStopping MongoDB...');
    mongod.kill('SIGINT');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await initiateReplicaSet();
  console.log('\nLocal replica set ready. Put this in your .env file:');
  console.log(`MONGODB_URI=mongodb://127.0.0.1:${PORT}/apaar_setu_dev?replicaSet=${REPLICA_SET}`);
  console.log('\nLeave this terminal open while you work. Ctrl+C stops the database.');
}

main().catch((error) => {
  console.error('Could not start the development database:', error.message);
  process.exit(1);
});
