// MongoDB connection helpers.
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Records whether the connected deployment supports multi-document transactions.
// A standalone mongod does NOT; a replica set or sharded cluster does (spec 02 section 6).
const dbState = { transactionsSupported: false, topology: 'unknown' };

async function detectTopology(connection = mongoose.connection) {
  const hello = await connection.db.admin().command({ hello: 1 });
  if (hello.setName) {
    dbState.topology = `replica set "${hello.setName}"`;
    dbState.transactionsSupported = true;
  } else if (hello.msg === 'isdbgrid') {
    dbState.topology = 'sharded cluster';
    dbState.transactionsSupported = true;
  } else {
    dbState.topology = 'standalone';
    dbState.transactionsSupported = false;
  }
  return { ...dbState };
}

async function connectDatabase(uri, options = {}) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, ...options });
  const topology = await detectTopology();
  if (!topology.transactionsSupported) {
    logger.warn(
      'MongoDB is running as a STANDALONE server. Certification, conflict resolution and other ' +
        'multi-document commits will be refused until you use a replica set. See README > Database setup.'
    );
  } else {
    logger.info(`MongoDB connected to database "${mongoose.connection.name}" (${topology.topology}); multi-document transactions available.`);
  }
  return topology;
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = { connectDatabase, disconnectDatabase, detectTopology, isDatabaseConnected, dbState };
