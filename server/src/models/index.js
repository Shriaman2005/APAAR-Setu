// Loads every model once so services can import them from one place.
const mongoose = require('mongoose');

const models = {
  User: require('./User'),
  Region: require('./Region'),
  Institution: require('./Institution'),
  Organisation: require('./Organisation'),
  Course: require('./Course'),
  SeatPolicy: require('./SeatPolicy'),
  SeatLedger: require('./SeatLedger'),
  Student: require('./Student'),
  Enrolment: require('./Enrolment'),
  UploadBatch: require('./UploadBatch'),
  StagingRow: require('./StagingRow'),
  ValidationIssue: require('./ValidationIssue'),
  Conflict: require('./Conflict'),
  RiskCase: require('./RiskCase'),
  Consent: require('./Consent'),
  VerificationRequest: require('./VerificationRequest'),
  AccessLog: require('./AccessLog'),
  Credential: require('./Credential'),
  CorrectionRequest: require('./CorrectionRequest'),
  AuditLog: require('./AuditLog'),
  AuditChainHead: require('./AuditChainHead'),
  Notification: require('./Notification'),
  SystemSetting: require('./SystemSetting'),
};

/**
 * Creates collections and indexes up front. Collections must exist before they are used inside a
 * transaction, and the seat-ledger validator gives database-level protection of 0 <= filled <= capacity.
 */
async function ensureDatabaseSetup() {
  for (const model of Object.values(models)) {
    await model.createCollection();
    await model.syncIndexes();
  }
  try {
    await mongoose.connection.db.command({
      collMod: models.SeatLedger.collection.collectionName,
      validator: models.SeatLedger.collectionValidator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } catch (error) {
    // Some hosted users lack collMod permission; the service-level guards still apply.
    require('../utils/logger').warn('Could not install the seat-ledger collection validator.', { reason: error.codeName });
  }
}

module.exports = { ...models, ensureDatabaseSetup };
