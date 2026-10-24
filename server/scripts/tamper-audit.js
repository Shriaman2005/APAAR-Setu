// npm run demo:tamper-audit -- [--sequence N] | --restore
// Development-only demonstration of tamper DETECTION. It edits one stored audit event directly in
// MongoDB (bypassing the application, as an attacker with database access would) and keeps a backup
// so --restore can put it back. Run "Verify chain" in the audit explorer afterwards.
const mongoose = require('mongoose');
const { refuseInProduction, connectForScript, disconnectDatabase } = require('./lib/scriptDb');

const BACKUP_COLLECTION = 'demo_audit_tamper_backups';

async function main() {
  refuseInProduction('Audit tamper demo');
  await connectForScript();
  const db = mongoose.connection.db;
  const audit = db.collection('auditlogs');
  const backups = db.collection(BACKUP_COLLECTION);

  if (process.argv.includes('--restore')) {
    const backup = await backups.findOne({}, { sort: { createdAt: -1 } });
    if (!backup) {
      console.log('No tamper backup found; nothing to restore.');
    } else {
      await audit.replaceOne({ _id: backup.original._id }, backup.original);
      await backups.deleteOne({ _id: backup._id });
      console.log(`Restored audit event sequence ${backup.original.sequence}. "Verify chain" should pass again.`);
    }
    await disconnectDatabase();
    return;
  }

  const index = process.argv.indexOf('--sequence');
  let sequence = index > -1 ? Number.parseInt(process.argv[index + 1], 10) : null;
  const total = await audit.countDocuments();
  if (total < 2) {
    console.error('There are fewer than 2 audit events; seed the database and use the app first.');
    process.exit(1);
  }
  if (!Number.isInteger(sequence)) sequence = Math.max(1, Math.floor(total / 2));
  const original = await audit.findOne({ sequence });
  if (!original) {
    console.error(`No audit event with sequence ${sequence}.`);
    process.exit(1);
  }
  await backups.insertOne({ original, createdAt: new Date() });
  await audit.updateOne({ _id: original._id }, { $set: { reason: `${original.reason || ''} [ALTERED BY TAMPER DEMO]`.trim() } });
  console.log(`Altered audit event sequence ${sequence} (${original.action}) directly in MongoDB.`);
  console.log('Open the audit explorer and click "Verify chain": it should report a mismatch at this sequence.');
  console.log('Undo with: npm run demo:tamper-audit -- --restore');
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('Tamper demo failed:', error.message);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
