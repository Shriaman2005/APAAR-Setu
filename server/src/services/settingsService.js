// Documented demo settings. Only the keys below exist; anything else is rejected.
const { SystemSetting, UploadBatch, ValidationIssue } = require('../models');
const { SEVERITY } = require('../config/constants');
const { recordAudit } = require('./auditService');
const { unprocessable } = require('../utils/AppError');

const SETTING_DEFINITIONS = Object.freeze({
  mockIdentityServiceMode: {
    label: 'Mock identity (APAAR-like) service availability',
    description:
      'Simulates the external identity service being available or unavailable. When UNAVAILABLE, the L2 ' +
      'identity check records PENDING for every row. No real registry is ever contacted.',
    type: 'enum',
    allowed: ['AVAILABLE', 'UNAVAILABLE'],
    defaultValue: 'AVAILABLE',
  },
  pendingIdentityPolicy: {
    label: 'Policy for PENDING identity checks',
    description:
      'BLOCK_UNTIL_RESOLVED (default): a batch cannot be certified while any identity check is pending; retry by ' +
      'revalidating. ALLOW_WITH_HEAD_DISPOSITION: the operator justifies and the college head accepts; the record ' +
      'is committed as PROVISIONAL and is never shown as identity-verified.',
    type: 'enum',
    allowed: ['BLOCK_UNTIL_RESOLVED', 'ALLOW_WITH_HEAD_DISPOSITION'],
    defaultValue: 'BLOCK_UNTIL_RESOLVED',
  },
  conflictReviewSlaDays: {
    label: 'Conflict review target (days)',
    description: 'Prototype service-level target used to show overdue conflict cases. Not an official deadline.',
    type: 'integer',
    min: 1,
    max: 90,
    defaultValue: 14,
  },
});

async function getSettings() {
  const stored = await SystemSetting.find({ key: { $in: Object.keys(SETTING_DEFINITIONS) } }).lean();
  const values = {};
  for (const [key, definition] of Object.entries(SETTING_DEFINITIONS)) values[key] = definition.defaultValue;
  for (const item of stored) values[item.key] = item.value;
  return values;
}

async function getSettingsWithDefinitions() {
  const values = await getSettings();
  return Object.entries(SETTING_DEFINITIONS).map(([key, definition]) => ({ key, value: values[key], ...definition }));
}

function validateSettingValue(key, value) {
  const definition = SETTING_DEFINITIONS[key];
  if (!definition) throw unprocessable('UNKNOWN_SETTING', `"${key}" is not a documented demo setting.`);
  if (definition.type === 'enum' && !definition.allowed.includes(value)) {
    throw unprocessable('INVALID_SETTING_VALUE', `${definition.label} must be one of: ${definition.allowed.join(', ')}.`);
  }
  if (definition.type === 'integer') {
    if (!Number.isInteger(value) || value < definition.min || value > definition.max) {
      throw unprocessable('INVALID_SETTING_VALUE', `${definition.label} must be a whole number from ${definition.min} to ${definition.max}.`);
    }
  }
}

async function updateSettings(changes, actor, reason) {
  const keys = Object.keys(changes);
  if (keys.length === 0) throw unprocessable('NO_CHANGES', 'No settings were changed.');
  for (const key of keys) validateSettingValue(key, changes[key]);
  const before = await getSettings();
  for (const key of keys) {
    await SystemSetting.updateOne({ key }, { $set: { value: changes[key], updatedBy: actor.id } }, { upsert: true });
  }
  const after = await getSettings();
  // Issues record how PENDING checks were handled when they were validated. If that policy changes,
  // open batches with pending checks must be revalidated so the new handling applies.
  let batchesFlagged = 0;
  if (before.pendingIdentityPolicy !== after.pendingIdentityPolicy) {
    const batchIds = await ValidationIssue.distinct('batchId', { current: true, severity: SEVERITY.PENDING });
    const result = await UploadBatch.updateMany(
      { batchId: { $in: batchIds }, status: { $in: ['VALIDATED', 'NEEDS_CORRECTION', 'READY_FOR_REVIEW', 'RETURNED_FOR_CORRECTION', 'COMMIT_FAILED'] } },
      { $set: { revalidationRequired: true, revalidationReason: 'PENDING_POLICY_CHANGED' } }
    );
    batchesFlagged = result.modifiedCount;
  }
  await recordAudit({
    actor,
    action: 'SETTINGS_UPDATED',
    entityType: 'SystemSetting',
    entityRef: keys.join(','),
    reason,
    payload: { changes: keys.map((key) => ({ key, from: before[key], to: after[key] })), batchesFlaggedForRevalidation: batchesFlagged },
  });
  return getSettingsWithDefinitions();
}

module.exports = { SETTING_DEFINITIONS, getSettings, getSettingsWithDefinitions, updateSettings };
