// HTTP handlers for admission batches. Business rules live in the services.
const ingestion = require('../services/batchIngestionService');
const queries = require('../services/batchQueryService');
const workflow = require('../services/batchWorkflowService');
const { certifyBatch } = require('../services/commitService');
const { recordAudit } = require('../services/auditService');
const { toCsv, sendCsv } = require('../utils/csvExport');
const { notFound } = require('../utils/AppError');

const config = (req) => req.app.locals.config;

function rowNumberParam(req) {
  const rowNumber = Number.parseInt(req.params.rowNumber, 10);
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > 1000000) throw notFound('Row not found in this batch.');
  return rowNumber;
}

async function templateInfo(req, res) {
  res.json(await ingestion.getTemplateInfo(req.user, config(req)));
}

async function templateCsv(_req, res) {
  sendCsv(res, `apaar-setu-admission-template-${ingestion.TEMPLATE_VERSION}.csv`, ingestion.getTemplateCsv());
}

async function upload(req, res) {
  const idempotencyKey = typeof req.get('Idempotency-Key') === 'string' ? req.get('Idempotency-Key').slice(0, 100) : undefined;
  const result = await ingestion.createBatch({
    user: req.user,
    file: req.file,
    academicYear: typeof req.body?.academicYear === 'string' ? req.body.academicYear.trim() : '',
    idempotencyKey,
    config: config(req),
  });
  res.status(result.idempotentReplay ? 200 : 202).json({
    batchId: result.batch.batchId,
    status: result.batch.status,
    receivedRows: result.receivedRows,
    idempotentReplay: result.idempotentReplay,
  });
}

async function list(req, res) {
  res.json(await queries.listBatches(req.user, req.query));
}

async function detail(req, res) {
  res.json(await queries.getBatchDetail(req.user, req.params.batchId));
}

async function review(req, res) {
  res.json(await queries.getReview(req.user, req.params.batchId));
}

async function rows(req, res) {
  res.json(await queries.listRows(req.user, req.params.batchId, req.query));
}

async function rowDetail(req, res) {
  res.json(await queries.getRowDetail(req.user, req.params.batchId, rowNumberParam(req)));
}

async function issues(req, res) {
  res.json(await queries.listIssues(req.user, req.params.batchId, req.query));
}

async function history(req, res) {
  res.json({ events: await queries.batchTimeline(req.user, req.params.batchId) });
}

async function exportIssues(req, res) {
  const items = await queries.exportIssues(req.user, req.params.batchId);
  await recordAudit({ actor: req.user, action: 'BATCH_EXPORTED', entityType: 'UploadBatch', entityRef: req.params.batchId, institutionId: req.user.institutionId, payload: { report: 'issues', rows: items.length } });
  const headers = ['rowNumber', 'layer', 'ruleCode', 'severity', 'field', 'message', 'resolutionStatus', 'justification', 'disposition'];
  sendCsv(res, `issues-${req.params.batchId}-DEMO.csv`, toCsv(headers, items));
}

async function exportSummary(req, res) {
  const { batch, rows: summaryRows } = await queries.exportSummary(req.user, req.params.batchId);
  await recordAudit({ actor: req.user, action: 'BATCH_EXPORTED', entityType: 'UploadBatch', entityRef: batch.batchId, institutionId: batch.institutionId, payload: { report: 'submission-summary', rows: summaryRows.length } });
  const header = [
    { rowNumber: `# Batch ${batch.batchId} | ${batch.academicYear} | status ${batch.status} | policy ${batch.validatedPolicyVersion || '-'} | SYNTHETIC DEMO DATA` },
  ];
  const headers = ['rowNumber', 'studentCode', 'externalIdDemo', 'courseCode', 'bucketCode', 'yearOfStudy', 'included', 'validationStatus'];
  sendCsv(res, `submission-summary-${batch.batchId}-DEMO.csv`, toCsv(headers, [...header, ...summaryRows]));
}

async function correctRow(req, res) {
  res.json(await workflow.correctRow(req.user, req.params.batchId, rowNumberParam(req), req.validBody.changes));
}

async function excludeRow(req, res) {
  res.json(await workflow.setRowIncluded(req.user, req.params.batchId, rowNumberParam(req), false, req.validBody.reason));
}

async function includeRow(req, res) {
  res.json(await workflow.setRowIncluded(req.user, req.params.batchId, rowNumberParam(req), true));
}

async function revalidate(req, res) {
  const batch = await workflow.revalidate(req.user, req.params.batchId, config(req));
  res.status(202).json({ batchId: batch.batchId, status: batch.status });
}

async function justify(req, res) {
  res.json(await workflow.justifyIssue(req.user, req.params.batchId, req.params.issueId, req.validBody.justification));
}

async function markReady(req, res) {
  const batch = await workflow.markReady(req.user, req.params.batchId, req.validBody.note);
  res.json({ batchId: batch.batchId, status: batch.status });
}

async function returnBatch(req, res) {
  const batch = await workflow.returnForCorrection(req.user, req.params.batchId, req.validBody.reason);
  res.json({ batchId: batch.batchId, status: batch.status });
}

async function acceptDispositions(req, res) {
  res.json(await workflow.acceptDispositions(req.user, req.params.batchId, req.validBody.issueIds, req.validBody.reason));
}

async function discard(req, res) {
  const batch = await workflow.discardBatch(req.user, req.params.batchId, req.validBody.reason);
  res.json({ batchId: batch.batchId, status: batch.status });
}

async function certify(req, res) {
  res.json(await certifyBatch(req.user, req.params.batchId, req.validBody));
}

module.exports = {
  templateInfo, templateCsv, upload, list, detail, review, rows, rowDetail, issues, history, exportIssues, exportSummary,
  correctRow, excludeRow, includeRow, revalidate, justify, markReady, returnBatch, acceptDispositions, discard, certify,
};
