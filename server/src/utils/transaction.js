// Runs a function inside a MongoDB multi-document transaction.
// Mongoose's connection.transaction() retries automatically on transient errors
// (for example a write conflict when two commits touch the same seat ledger row).
const mongoose = require('mongoose');
const { dbState } = require('../config/db');
const { AppError } = require('./AppError');

async function runInTransaction(work) {
  if (!dbState.transactionsSupported) {
    throw new AppError(
      503,
      'TRANSACTIONS_UNAVAILABLE',
      'This action needs MongoDB transactions, which require a replica set. Ask the developer to start the ' +
        'database with "npm run db:dev" (or another replica set) as described in the README.'
    );
  }
  let result;
  await mongoose.connection.transaction(async (session) => {
    result = await work(session);
  });
  return result;
}

module.exports = { runInTransaction };
