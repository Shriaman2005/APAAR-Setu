import { Alert, DataTable, KeyValue, KpiTile, SeatBar, StatusBadge, formatDate } from '../../../components/ui';

export function BatchSummary({ batch, readiness }) {
  const c = batch.counts || {};
  return (
    <>
      <div className="row g-2 mb-3">
        <div className="col-6 col-md-3 col-xl-2"><KpiTile label="Rows in file" value={c.totalRows} /></div>
        <div className="col-6 col-md-3 col-xl-2"><KpiTile label="Valid rows" value={c.validRows} status="success" /></div>
        <div className="col-6 col-md-3 col-xl-2"><KpiTile label="Open errors" value={c.openErrors} status={c.openErrors ? 'danger' : undefined} /></div>
        <div className="col-6 col-md-3 col-xl-2"><KpiTile label="Warnings" value={c.warnings} status={c.warnings ? 'warning' : undefined} hint={c.warningsNeedingJustification ? `${c.warningsNeedingJustification} need justification` : undefined} /></div>
        <div className="col-6 col-md-3 col-xl-2"><KpiTile label="Pending checks" value={c.pendingChecks} status={c.pendingChecks ? 'warning' : undefined} /></div>
        <div className="col-6 col-md-3 col-xl-2"><KpiTile label="Risk signals (non-blocking)" value={c.riskFlags} /></div>
        <div className="col-6 col-md-3 col-xl-2"><KpiTile label="Excluded rows" value={c.excludedRows} /></div>
        <div className="col-6 col-md-3 col-xl-2"><KpiTile label="Changed since validation" value={c.staleRows} status={c.staleRows ? 'warning' : undefined} /></div>
        <div className="col-6 col-md-3 col-xl-2"><KpiTile label="Dispositions awaiting head" value={c.dispositionsAwaitingHead} /></div>
      </div>

      {batch.revalidationRequired && (
        <Alert kind="warning" className="mb-3" title="Revalidation required">
          The current results are out of date ({batch.revalidationReason?.replaceAll('_', ' ').toLowerCase()}). The operator must run “Revalidate changed rows”.
        </Alert>
      )}
      {batch.returnInfo && ['RETURNED_FOR_CORRECTION', 'NEEDS_CORRECTION', 'VALIDATED'].includes(batch.status) && (
        <Alert kind="info" className="mb-3" title={`Returned by ${batch.returnInfo.byName} on ${formatDate(batch.returnInfo.at, true)}`}>{batch.returnInfo.reason}</Alert>
      )}
      {batch.lastCommitError && batch.status !== 'COMMITTED' && (
        <Alert kind="error" className="mb-3" title={`Last certification attempt failed (${batch.lastCommitError.code})`}>{batch.lastCommitError.message}</Alert>
      )}
      {batch.commitSummary && (
        <Alert kind="success" className="mb-3" title="Certified and committed">
          {batch.commitSummary.committedRows} record(s) committed on {formatDate(batch.commitSummary.committedAt, true)} under policy {batch.commitSummary.policyVersion}
          {batch.certification?.byName ? ` by ${batch.certification.byName}` : ''}. {batch.commitSummary.conflictsCreated ? `${batch.commitSummary.conflictsCreated} conflict case(s) opened for review.` : ''}
          {batch.commitSummary.provisionalEnrolments ? ` ${batch.commitSummary.provisionalEnrolments} enrolment(s) are PROVISIONAL because their identity check was pending.` : ''}
        </Alert>
      )}
      {batch.discarded && <Alert kind="info" className="mb-3" title="Discarded">{batch.discarded.reason}</Alert>}

      <section className="card-gov mb-3">
        <h2>Batch details</h2>
        <KeyValue items={[
          ['Status', <StatusBadge key="s" status={batch.status} />],
          ['Academic year', batch.academicYear],
          ['File', `${batch.sourceFileName} (${(batch.fileSizeBytes / 1024).toFixed(1)} KB)`],
          ['Uploaded by', `${batch.createdByName || '-'} on ${formatDate(batch.createdAt, true)}`],
          ['Validation runs', batch.validationRunCount],
          ['Last validated', formatDate(batch.lastValidatedAt, true)],
          ['Validated under policy', batch.validatedPolicyVersion || '-'],
          ['Active policy now', readiness?.activePolicyVersion || '-'],
          ['Ruleset', batch.validationRulesetVersion || '-'],
          batch.readyForReview && ['Marked ready', `${batch.readyForReview.byName} on ${formatDate(batch.readyForReview.at, true)}${batch.readyForReview.note ? ` - "${batch.readyForReview.note}"` : ''}`],
        ]} />
      </section>
    </>
  );
}

export function BlockerList({ title, blockers, okText }) {
  if (!blockers) return null;
  return blockers.length === 0 ? (
    <Alert kind="success" className="mb-3" title={title}>{okText}</Alert>
  ) : (
    <Alert kind="warning" className="mb-3" title={title}>
      <ul className="mb-0">{blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul>
    </Alert>
  );
}

export function LedgerImpact({ rows }) {
  if (!rows) return null;
  return (
    <section className="card-gov mb-3">
      <h2>Seat ledger impact if certified now</h2>
      <DataTable
        rowKey={(row) => `${row.courseCode}-${row.bucketCode}`}
        columns={[
          { key: 'courseCode', header: 'Course' },
          { key: 'bucketCode', header: 'Bucket' },
          { key: 'requested', header: 'This batch', numeric: true },
          { key: 'usage', header: 'Filled / capacity now', render: (row) => (row.capacity === null ? 'Not configured' : <SeatBar filled={row.filled} capacity={row.capacity} />) },
          { key: 'remainingAfter', header: 'Remaining after', numeric: true, render: (row) => row.remainingAfter ?? '-' },
          { key: 'fits', header: 'Fits?', render: (row) => <StatusBadge status={row.fits ? 'VALID' : 'HAS_ERRORS'} label={row.fits ? 'Within capacity' : 'Exceeds capacity'} /> },
        ]}
        rows={rows}
      />
      <p className="small text-muted mt-2 mb-0">Capacities are synthetic demo configuration. Capacity is checked again atomically when you certify.</p>
    </section>
  );
}
