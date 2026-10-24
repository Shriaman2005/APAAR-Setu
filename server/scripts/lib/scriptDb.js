// Shared helpers for developer scripts (seed, reset, tamper demo, ledger check).
const { config } = require('../../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../../src/config/db');
const { ensureDatabaseSetup } = require('../../src/models');
const { ensureAuditChainHead } = require('../../src/services/auditService');

function refuseInProduction(scriptName) {
  if (config.isProduction) {
    console.error(`${scriptName} refuses to run when NODE_ENV=production. It is a development-only tool.`);
    process.exit(1);
  }
}

async function connectForScript() {
  if (!config.mongodbUri) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env and fill it in (see README).');
    process.exit(1);
  }
  await connectDatabase(config.mongodbUri);
  await ensureDatabaseSetup();
  await ensureAuditChainHead();
}

module.exports = { config, refuseInProduction, connectForScript, disconnectDatabase };
