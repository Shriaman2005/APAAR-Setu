// Entry point: validate config, connect to MongoDB, prepare collections, recover interrupted
// jobs and start listening.
const { config, validateConfig } = require('./config/env');
const { connectDatabase } = require('./config/db');
const { ensureDatabaseSetup } = require('./models');
const { ensureAuditChainHead } = require('./services/auditService');
const { recoverInterruptedJobs } = require('./services/batchIngestionService');
const { createApp } = require('./app');
const logger = require('./utils/logger');

async function start() {
  validateConfig(config);
  await connectDatabase(config.mongodbUri);
  await ensureDatabaseSetup();
  await ensureAuditChainHead();
  const recovered = await recoverInterruptedJobs();
  if (recovered.validating || recovered.committing) {
    logger.warn('Recovered interrupted jobs after restart', recovered);
  }
  const app = createApp(config);
  app.listen(config.port, () => {
    logger.info(`APAAR Setu API listening on http://localhost:${config.port} (${config.nodeEnv})`);
  });
}

start().catch((error) => {
  logger.error('Server failed to start', { message: error.message });
  process.exit(1);
});
