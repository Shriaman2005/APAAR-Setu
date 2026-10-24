// CSV upload -> staged rows -> validation job.
// Uploaded rows are staging data only; nothing here writes to the official register.
const path = require('path');
const { parse } = require('csv-parse/sync');
const {
  UploadBatch, StagingRow, Institution, SeatPolicy, Course,
} = require('../models');
const {
  BATCH_STATUS, BATCH_OPEN_STATUSES, BATCH_REVALIDATABLE_STATUSES, CSV_COLUMNS, POLICY_STATUS,
} = require('../config/constants');
const { AppError, conflict, unprocessable, forbidden } = require('../utils/AppError');
const { sha256Hex } = require('../utils/hash');
const { newBatchId } = require('../utils/ids');
const { isValidAcademicYear } = require('../utils/dates');
const { runValidation } = require('./validation/pipeline');
const { VALIDATION_RULESET } = require('./validation/ruleset');
const { recordAudit } = require('./auditService');
const logger = require('../utils/logger');

const TEMPLATE_VERSION = 'TEMPLATE-DEMO-v1';
const REQUIRED_COLUMNS = ['studentCode', 'studentName', 'courseCode', 'academicYear', 'bucketCode', 'yearOfStudy', 'admittedOn'];
const OPTIONAL_COLUMNS = ['externalIdDemo', 'contactToken'];
const UPPERCASE_FIELDS = ['studentCode', 'courseCode', 'bucketCode', 'contactToken'];
const MAX_CELL_LENGTH = 200;

const COLUMN_NOTES = {
  studentCode: 'Synthetic demo student code such as STU-001. Not an official AICTE identifier.',
  studentName: 'Synthetic display name. Letters, spaces, dots, apostrophes and hyphens.',
  courseCode: 'Must be a course configured for your institution in the batch academic year.',
  academicYear: 'Must equal the batch academic year, e.g. 2026-27.',
  bucketCode: 'Must be a bucket configured for the course in the active seat policy.',
  externalIdDemo: 'Fake 12-digit identifier for the MOCK identity check only (required while the mock check is enabled).',
  contactToken: 'Optional synthetic token such as PHONE-DEMO-A. Never a real phone number.',
  yearOfStudy: 'Whole number from 1 to the course duration.',
  admittedOn: 'Admission date in YYYY-MM-DD format.',
};

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------
async function getTemplateInfo(user, config) {
  const institution = await Institution.findById(user.institutionId).lean();
  const policies = await SeatPolicy.find({ status: POLICY_STATUS.PUBLISHED }).sort({ academicYear: -1 }).lean();
  const academicYears = [];
  for (const policy of policies) {
    const courses = await Course.find({ institutionId: user.institutionId, academicYear: policy.academicYear }).sort({ courseCode: 1 }).lean();
    const scopes = policy.scopes.filter((scope) => scope.institutionCode === institution.institutionCode);
    academicYears.push({
      academicYear: policy.academicYear,
      policyVersion: policy.version,
      sourceType: policy.sourceType,
      admissionWindow: policy.admissionWindow,
      courses: courses.map((course) => ({
        courseCode: course.courseCode,
        programName: course.programName,
        durationYears: course.durationYears,
        buckets: (scopes.find((scope) => scope.courseCode === course.courseCode)?.buckets || []).map((bucket) => bucket.code),
      })),
    });
  }
  return {
    templateVersion: TEMPLATE_VERSION,
    institution: { code: institution.institutionCode, name: institution.name },
    columns: CSV_COLUMNS.map((name) => ({
      name,
      required: REQUIRED_COLUMNS.includes(name) || (name === 'externalIdDemo' && VALIDATION_RULESET.mockIdentityCheckEnabled),
      description: COLUMN_NOTES[name],
    })),
    rowNumbering: 'Row numbers match your spreadsheet: row 1 is the header, so the first student is row 2.',
    limits: { maxUploadMb: config.maxUploadMb, maxRows: config.maxRowsPerBatch },
    academicYears,
    notice: 'Synthetic demo template for a prototype. It is not an official AICTE template and is not synchronised with any live system.',
  };
}

function getTemplateCsv() {
  return `${CSV_COLUMNS.join(',')}\r\n`;
}

// ---------------------------------------------------------------------------
// File checks
// ---------------------------------------------------------------------------
const BINARY_SIGNATURES = [
  Buffer.from('PK'), // zip / xlsx
  Buffer.from('%PDF'),
  Buffer.from([0x89, 0x50, 0x4e, 0x47]), // png
  Buffer.from([0xff, 0xd8, 0xff]), // jpeg
  Buffer.from('GIF8'),
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), // old .xls / OLE
  Buffer.from('MZ'), // executable
];

function assertLooksLikeCsvText(buffer) {
  if (BINARY_SIGNATURES.some((signature) => buffer.subarray(0, signature.length).equals(signature))) {
    throw new AppError(415, 'FILE_CONTENT_NOT_CSV', 'The file content is not plain-text CSV (it looks like a binary or spreadsheet file). Save it as CSV and try again.');
  }
  if (buffer.subarray(0, 8192).includes(0)) {
    throw new AppError(415, 'FILE_CONTENT_NOT_CSV', 'The file contains binary data and is not a plain-text CSV file.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw unprocessable('FILE_ENCODING_INVALID', 'The file is not valid UTF-8 text. Save it as "CSV UTF-8" and try again.');
  }
}

// Keeps only the base file name and safe characters (prevents path tricks such as ../../x.csv).
function safeFileName(originalName) {
  const base = path.basename(String(originalName || 'upload.csv').replace(/\\/g, '/'));
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 100);
  return cleaned || 'upload.csv';
}

function normaliseRecord(record) {
  const fields = {};
  const raw = {};
  for (const column of CSV_COLUMNS) {
    const original = record[column] === undefined ? '' : String(record[column]);
    raw[column] = original.slice(0, MAX_CELL_LENGTH);
    let value = original.trim().slice(0, MAX_CELL_LENGTH);
    if (column === 'studentName') value = value.replace(/\s+/g, ' ');
    if (UPPERCASE_FIELDS.includes(column)) value = value.toUpperCase();
    fields[column] = value;
  }
  return { raw, fields };
}

function normaliseFieldValue(field, value) {
  let text = String(value ?? '').trim().slice(0, MAX_CELL_LENGTH);
  if (field === 'studentName') text = text.replace(/\s+/g, ' ');
  if (UPPERCASE_FIELDS.includes(field)) text = text.toUpperCase();
  return text;
}

/**
 * Parses CSV text strictly. Returns { header, records } where records are objects keyed by column.
 */
function parseCsvText(text, maxRows) {
  let rows;
  try {
    rows = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      max_record_size: 20000,
      to_line: maxRows + 50, // stop early on huge files; the row-count check below reports the problem
    });
  } catch (error) {
    const line = error.lines || error.line;
    throw unprocessable('CSV_MALFORMED', `The CSV file could not be read${line ? ` near line ${line}` : ''}: ${error.code === 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH' ? 'a row has a different number of columns than the header' : 'check quotes and separators'}.`, { line: line || null });
  }
  if (rows.length === 0) throw unprocessable('CSV_EMPTY', 'The CSV file is empty.');

  const canonicalByLower = new Map(CSV_COLUMNS.map((column) => [column.toLowerCase(), column]));
  const header = rows[0].map((cell) => canonicalByLower.get(String(cell).trim().toLowerCase()) || String(cell).trim());
  const unexpected = header.filter((column) => !CSV_COLUMNS.includes(column));
  const duplicates = header.filter((column, index) => header.indexOf(column) !== index);
  const required = [...REQUIRED_COLUMNS, ...(VALIDATION_RULESET.mockIdentityCheckEnabled ? ['externalIdDemo'] : [])];
  const missing = required.filter((column) => !header.includes(column));
  if (unexpected.length || duplicates.length || missing.length) {
    throw unprocessable('CSV_HEADER_INVALID', 'The CSV header does not match the current template.', {
      missingColumns: missing,
      unexpectedColumns: unexpected,
      duplicateColumns: [...new Set(duplicates)],
      expectedColumns: CSV_COLUMNS,
    });
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) throw unprocessable('CSV_NO_DATA_ROWS', 'The CSV file has a header but no student rows.');
  if (dataRows.length > maxRows) {
    throw new AppError(413, 'TOO_MANY_ROWS', `The file has more than ${maxRows} rows, which is the configured limit per batch. Split it into smaller files.`);
  }
  const records = dataRows.map((cells) => {
    const record = {};
    header.forEach((column, index) => { record[column] = cells[index]; });
    return record;
  });
  return { header, records };
}

// ---------------------------------------------------------------------------
// Validation job (lightweight in-process worker, spec 05 section 6)
// ---------------------------------------------------------------------------
/**
 * Moves the batch to VALIDATING and runs the pipeline. In "async" mode the HTTP request returns
 * immediately and the job continues in the background; status is stored in MongoDB so the UI can
 * poll it. If the server restarts mid-run, recoverInterruptedJobs() marks the batch retry-required.
 */
async function startValidation(batchId, actor, { awaitCompletion = false, fromStatuses = BATCH_REVALIDATABLE_STATUSES, institutionId } = {}) {
  const filter = { batchId, status: { $in: fromStatuses } };
  if (institutionId) filter.institutionId = institutionId;
  const current = await UploadBatch.findOne({ batchId, ...(institutionId ? { institutionId } : {}) }, { status: 1 }).lean();
  const batch = await UploadBatch.findOneAndUpdate(
    filter,
    {
      $set: { status: BATCH_STATUS.VALIDATING, validationStartedAt: new Date() },
      $push: { statusHistory: { from: current?.status, to: BATCH_STATUS.VALIDATING, at: new Date(), by: actor.id, reason: 'Validation requested' } },
    },
    { returnDocument: 'after' }
  ).lean();
  if (!batch) {
    if (current?.status === BATCH_STATUS.VALIDATING) throw conflict('VALIDATION_IN_PROGRESS', 'Validation is already running for this batch. Refresh the status in a moment.');
    throw conflict('BATCH_NOT_REVALIDATABLE', `A batch in status ${current?.status || 'unknown'} cannot be validated.`);
  }

  const job = runValidation(batchId, actor)
    .then(async (result) => {
      await recordAudit({
        actor,
        action: 'BATCH_VALIDATED',
        entityType: 'UploadBatch',
        entityRef: batchId,
        institutionId: batch.institutionId,
        regionIds: [batch.regionId],
        payload: { run: result.runNumber, status: result.batch.status, counts: result.counts, policyVersion: result.policyVersion },
      });
      return result.batch;
    })
    .catch(async (error) => {
      logger.error('Validation job failed', { batchId, reason: error.message });
      await UploadBatch.updateOne(
        { batchId, status: BATCH_STATUS.VALIDATING },
        {
          $set: { status: BATCH_STATUS.NEEDS_CORRECTION, revalidationRequired: true, revalidationReason: 'VALIDATION_ERROR' },
          $push: { statusHistory: { from: BATCH_STATUS.VALIDATING, to: BATCH_STATUS.NEEDS_CORRECTION, at: new Date(), reason: 'Validation failed; retry required' } },
        }
      );
      if (awaitCompletion) throw error;
      return null;
    });

  if (awaitCompletion) return job;
  return batch;
}

// Called at server start: a crash during validation or commit must not leave a batch stuck.
async function recoverInterruptedJobs() {
  const now = new Date();
  const validating = await UploadBatch.updateMany(
    { status: BATCH_STATUS.VALIDATING },
    {
      $set: { status: BATCH_STATUS.NEEDS_CORRECTION, revalidationRequired: true, revalidationReason: 'VALIDATION_INTERRUPTED' },
      $push: { statusHistory: { from: BATCH_STATUS.VALIDATING, to: BATCH_STATUS.NEEDS_CORRECTION, at: now, reason: 'Server restarted during validation; retry required' } },
    }
  );
  // The commit is one transaction: if it had committed, the status would already be COMMITTED.
  const committing = await UploadBatch.updateMany(
    { status: BATCH_STATUS.COMMITTING },
    {
      $set: {
        status: BATCH_STATUS.COMMIT_FAILED,
        lastCommitError: { code: 'COMMIT_INTERRUPTED', message: 'The server restarted before the commit finished. Nothing was committed; retry certification.', at: now },
      },
      $push: { statusHistory: { from: BATCH_STATUS.COMMITTING, to: BATCH_STATUS.COMMIT_FAILED, at: now, reason: 'Server restarted during commit' } },
    }
  );
  return { validating: validating.modifiedCount, committing: committing.modifiedCount };
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
/**
 * Creates a batch from an uploaded CSV file.
 * @returns {{ batch, receivedRows, idempotentReplay }}
 */
async function createBatch({ user, file, academicYear, idempotencyKey, config }) {
  if (!user.institutionId) throw forbidden('Your account is not assigned to an institution.');
  const institution = await Institution.findById(user.institutionId).lean();
  if (!institution || institution.status !== 'ACTIVE') throw forbidden('Your institution is not active in this prototype.');

  if (idempotencyKey) {
    const previous = await UploadBatch.findOne({ createdBy: user.id, idempotencyKey }).lean();
    if (previous) return { batch: previous, receivedRows: previous.counts.totalRows, idempotentReplay: true };
  }

  if (!file) throw unprocessable('FILE_REQUIRED', 'Choose a CSV file to upload.');
  if (!isValidAcademicYear(academicYear)) throw unprocessable('ACADEMIC_YEAR_INVALID', 'Choose a valid academic year such as 2026-27.');
  const policy = await SeatPolicy.findOne({ academicYear, status: POLICY_STATUS.PUBLISHED }, { version: 1 }).lean();
  if (!policy) throw unprocessable('NO_ACTIVE_POLICY_FOR_YEAR', `No seat policy is published for ${academicYear}. Choose another academic year.`);

  const text = assertLooksLikeCsvText(file.buffer);
  const { records } = parseCsvText(text, config.maxRowsPerBatch);

  const fileHash = sha256Hex(file.buffer);
  const duplicate = await UploadBatch.findOne(
    { institutionId: user.institutionId, fileHash, status: { $in: [...BATCH_OPEN_STATUSES, BATCH_STATUS.COMMITTED] } },
    { batchId: 1, status: 1 }
  ).lean();
  if (duplicate) {
    throw conflict('DUPLICATE_FILE', `This exact file was already uploaded as batch ${duplicate.batchId} (status ${duplicate.status}). Open that batch instead of uploading again.`, { existingBatchId: duplicate.batchId });
  }

  let batch;
  for (let attempt = 0; attempt < 5 && !batch; attempt += 1) {
    try {
      batch = await UploadBatch.create({
        batchId: newBatchId(institution.institutionCode),
        institutionId: institution._id,
        regionId: institution.regionId,
        academicYear,
        sourceFileName: safeFileName(file.originalname),
        fileHash,
        fileSizeBytes: file.size,
        status: BATCH_STATUS.UPLOADED,
        createdBy: user.id,
        idempotencyKey: idempotencyKey || undefined,
        counts: { totalRows: records.length, includedRows: records.length },
        statusHistory: [{ from: null, to: BATCH_STATUS.UPLOADED, at: new Date(), by: user.id, reason: 'File uploaded' }],
      });
    } catch (error) {
      if (error.code === 11000 && idempotencyKey && String(error.message).includes('idempotencyKey')) {
        const previous = await UploadBatch.findOne({ createdBy: user.id, idempotencyKey }).lean();
        return { batch: previous, receivedRows: previous.counts.totalRows, idempotentReplay: true };
      }
      if (error.code !== 11000) throw error; // otherwise a batchId collision: try a new random id
    }
  }
  if (!batch) throw new Error('Could not allocate a unique batch id');

  const stagingRows = records.map((record, index) => {
    const { raw, fields } = normaliseRecord(record);
    return {
      batchId: batch.batchId,
      institutionId: institution._id,
      rowNumber: index + 2, // row 1 is the header
      rawSafeFields: raw,
      fields,
    };
  });
  await StagingRow.insertMany(stagingRows, { ordered: true });

  await recordAudit({
    actor: user,
    action: 'BATCH_UPLOADED',
    entityType: 'UploadBatch',
    entityRef: batch.batchId,
    institutionId: institution._id,
    regionIds: [institution.regionId],
    payload: { rows: records.length, academicYear, fileHashPrefix: fileHash.slice(0, 12), fileName: batch.sourceFileName },
  });

  const awaitCompletion = config.validationMode === 'sync';
  const started = await startValidation(batch.batchId, user, { awaitCompletion, fromStatuses: [BATCH_STATUS.UPLOADED] });
  return { batch: started, receivedRows: records.length, idempotentReplay: false };
}

module.exports = {
  TEMPLATE_VERSION,
  REQUIRED_COLUMNS,
  OPTIONAL_COLUMNS,
  getTemplateInfo,
  getTemplateCsv,
  createBatch,
  startValidation,
  recoverInterruptedJobs,
  parseCsvText,
  safeFileName,
  normaliseFieldValue,
  assertLooksLikeCsvText,
};
