import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, downloadFile } from '../../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../../hooks/useApi';
import { useAuth } from '../../../features/auth/AuthContext';
import { ReasonDialog, ConfirmDialog, TextAreaField } from '../../../components/forms';
import { Alert, Button, DataState, PageHeader, StatusBadge, formatDate } from '../../../components/ui';
import { BatchSummary, BlockerList, LedgerImpact } from './BatchSummary';
import IssuesPanel from './IssuesPanel';
import RowsPanel from './RowsPanel';
import RowEditor from './RowEditor';
import CertifyDialog from './CertifyDialog';

const BUSY_STATUSES = ['UPLOADED', 'VALIDATING', 'COMMITTING'];

function HistoryPanel({ batchId, refreshKey }) {
  const history = useApi(() => api(`/batches/${batchId}/history`), [batchId, refreshKey]);
  return (
    <DataState loading={history.loading} error={history.error} onRetry={history.reload} hasData={Boolean(history.data)} empty={history.data?.events.length === 0} emptyTitle="No history yet">
      <ol className="timeline">
        {history.data?.events.map((event) => (
          <li key={event.sequence}>
            <strong>{event.action.replaceAll('_', ' ').toLowerCase()}</strong> by {event.actorName} <span className="small text-muted">({formatDate(event.timestamp, true)}, audit #{event.sequence})</span>
            {event.reason && <div className="small">Reason: {event.reason}</div>}
          </li>
        ))}
      </ol>
    </DataState>
  );
}

export default function BatchDetailPage() {
  const { batchId } = useParams();
  const { user } = useAuth();
  const isHead = user.role === 'COLLEGE_HEAD';
  useDocumentTitle(`Batch ${batchId}`);
  const detail = useApi(() => api(`/batches/${batchId}`), [batchId]);
  const review = useApi(() => (isHead ? api(`/batches/${batchId}/review`) : Promise.resolve(null)), [batchId, isHead]);
  const [tab, setTab] = useState('issues');
  const [refreshKey, setRefreshKey] = useState(0);
  const [openRow, setOpenRow] = useState(null);
  const [dialog, setDialog] = useState(null); // markReady | return | discard | certify
  const [readyNote, setReadyNote] = useState('');
  const action = useAction();

  const status = detail.data?.batch.status;
  const reloadDetail = detail.reload;
  const reloadReview = review.reload;
  const refreshAll = useCallback(() => {
    reloadDetail();
    reloadReview();
    setRefreshKey((key) => key + 1);
  }, [reloadDetail, reloadReview]);

  // While the background job runs, refresh the status automatically.
  useEffect(() => {
    if (!BUSY_STATUSES.includes(status)) return undefined;
    const timer = setInterval(reloadDetail, 1500);
    return () => clearInterval(timer);
  }, [status, reloadDetail]);
  useEffect(() => {
    if (status && !BUSY_STATUSES.includes(status)) setRefreshKey((key) => key + 1);
  }, [status]);

  const closeDialog = () => { setDialog(null); action.setError(null); };
  async function perform(fn, success) {
    const result = await action.run(fn, { success, onError: () => {} });
    if (result !== undefined) closeDialog();
    refreshAll();
    return result;
  }

  const permissions = detail.data?.permissions || {};
  const readiness = detail.data?.readiness;
  const batch = detail.data?.batch;
  const downloadError = action.error && !dialog ? action.error : null;

  return (
    <>
      <PageHeader
        title={`Batch ${batchId}`}
        subtitle={batch ? <span>{batch.sourceFileName} - {batch.academicYear} - <StatusBadge status={batch.status} /></span> : null}
        breadcrumbs={[{ label: 'Dashboard', to: '/college' }, { label: isHead ? 'Submissions' : 'Batches', to: '/college/batches' }, { label: batchId }]}
        onRefresh={refreshAll}
        refreshing={detail.loading}
      />
      <DataState loading={detail.loading} error={detail.error} onRetry={detail.reload} hasData={Boolean(detail.data)}>
        {batch && (
          <>
            {BUSY_STATUSES.includes(batch.status) && <Alert kind="info" className="mb-3" title="Working...">{batch.status === 'COMMITTING' ? 'The commit transaction is running.' : 'Validation is running in the background. This page refreshes automatically.'}</Alert>}

            <div className="card-gov mb-3">
              <h2 className="h3">Actions</h2>
              {!isHead ? (
                <div className="d-flex flex-wrap gap-2">
                  <Button icon="arrow-repeat" onClick={() => perform(() => api(`/batches/${batchId}/revalidate`, { method: 'POST' }), 'Revalidation started.')} loading={action.busy && !dialog} loadingText="Starting..." disabled={!permissions.canRevalidate} disabledReason={`Revalidation is not available while the batch is ${batch.status}.`}>Revalidate changed rows</Button>
                  <Button variant="success" icon="send-check" onClick={() => setDialog('markReady')} disabled={!readiness?.canMarkReady} disabledReason={readiness?.markReadyBlockers.map((b) => b.message).join(' ')}>Mark ready for review</Button>
                  <Button variant="outline-primary" icon="download" onClick={() => action.run(() => downloadFile(`/batches/${batchId}/issues.csv`, 'issues.csv'))}>Export issues</Button>
                  <Button variant="outline-danger" icon="trash" onClick={() => setDialog('discard')} disabled={!permissions.canDiscard} disabledReason={`A ${batch.status} batch cannot be discarded.`}>Discard batch</Button>
                </div>
              ) : (
                <div className="d-flex flex-wrap gap-2">
                  <Button variant="success" icon="patch-check" onClick={() => setDialog('certify')} disabled={!readiness?.canCertify} disabledReason={readiness?.certifyBlockers.map((b) => b.message).join(' ')}>Certify and submit</Button>
                  <Button variant="outline-danger" icon="arrow-return-left" onClick={() => setDialog('return')} disabled={!permissions.canReturn} disabledReason="Only a batch awaiting review (or a failed commit) can be returned.">Return for correction</Button>
                  <Button variant="outline-primary" icon="download" onClick={() => action.run(() => downloadFile(`/batches/${batchId}/summary.csv`, 'summary.csv'))}>Export submission summary</Button>
                  <Button variant="outline-primary" icon="download" onClick={() => action.run(() => downloadFile(`/batches/${batchId}/issues.csv`, 'issues.csv'))}>Export issues</Button>
                </div>
              )}
              {downloadError && <p className="text-danger small mt-2 mb-0">{downloadError.message}</p>}
            </div>

            {!isHead && batch.status !== 'COMMITTED' && batch.status !== 'DISCARDED' && (
              <BlockerList title={readiness?.canMarkReady ? 'Ready to hand over' : 'Before you can mark this batch ready'} blockers={readiness?.markReadyBlockers} okText="All checks are satisfied. Mark the batch ready for the college head." />
            )}
            {isHead && ['READY_FOR_REVIEW', 'COMMIT_FAILED'].includes(batch.status) && (
              <BlockerList title={readiness?.canCertify ? 'Ready to certify' : 'Before you can certify'} blockers={readiness?.certifyBlockers} okText="No blocking errors remain and all required dispositions are accepted." />
            )}

            <BatchSummary batch={batch} readiness={readiness} />
            {isHead && <LedgerImpact rows={review.data?.ledgerImpact} />}

            <div className="card-gov">
              <ul className="nav nav-tabs mb-3" role="tablist">
                {[['issues', 'Validation issues'], ['rows', 'Rows'], ['history', 'History']].map(([key, label]) => (
                  <li className="nav-item" key={key} role="presentation">
                    <button type="button" role="tab" aria-selected={tab === key} className={`nav-link ${tab === key ? 'active fw-semibold' : ''}`} onClick={() => setTab(key)}>{label}</button>
                  </li>
                ))}
              </ul>
              {tab === 'issues' && <IssuesPanel batchId={batchId} permissions={permissions} isHead={isHead} refreshKey={refreshKey} onChanged={refreshAll} onOpenRow={setOpenRow} />}
              {tab === 'rows' && <RowsPanel batchId={batchId} permissions={permissions} refreshKey={refreshKey} onChanged={refreshAll} onOpenRow={setOpenRow} />}
              {tab === 'history' && <HistoryPanel batchId={batchId} refreshKey={refreshKey} />}
            </div>
          </>
        )}
      </DataState>

      {openRow && <RowEditor batchId={batchId} rowNumber={openRow} canEdit={Boolean(permissions.canEditRows)} onClose={() => setOpenRow(null)} onSaved={refreshAll} />}

      {dialog === 'markReady' && (
        <ConfirmDialog title="Mark ready for review" confirmLabel="Mark ready for review" variant="success" onClose={closeDialog} busy={action.busy} error={action.error}
          onConfirm={() => perform(() => api(`/batches/${batchId}/mark-ready`, { method: 'POST', body: { note: readyNote } }), 'Batch handed to the college head for review.')}
          message="This hands the batch to your college head. It is NOT certification and does not change the official register.">
          <TextAreaField label="Note for the college head (optional)" value={readyNote} onChange={setReadyNote} maxLength={300} />
        </ConfirmDialog>
      )}
      {dialog === 'discard' && (
        <ReasonDialog title="Discard this batch" variant="danger" confirmLabel="Discard batch" onClose={closeDialog} busy={action.busy} error={action.error}
          description="The staged rows will not be committed. The batch stays in the history as DISCARDED. This cannot be undone."
          onSubmit={(reason) => perform(() => api(`/batches/${batchId}/discard`, { method: 'POST', body: { reason } }), 'Batch discarded.')} />
      )}
      {dialog === 'return' && (
        <ReasonDialog title="Return for correction" variant="danger" confirmLabel="Return to operator" onClose={closeDialog} busy={action.busy} error={action.error}
          description="The operator will be notified in-app and can correct and revalidate. Nothing is committed."
          onSubmit={(reason) => perform(() => api(`/batches/${batchId}/return`, { method: 'POST', body: { reason } }), 'Batch returned to the operator.')} />
      )}
      {dialog === 'certify' && (
        <CertifyDialog batchId={batchId} declaration={review.data?.declaration} confirmationNote={review.data?.confirmationNote} onClose={closeDialog} busy={action.busy} error={action.error}
          onConfirm={() => perform(() => api(`/batches/${batchId}/certify`, { method: 'POST', body: { declarationAccepted: true, confirmBatchId: batchId } }), (r) => (r.idempotentReplay ? 'This batch was already committed.' : `Certified: ${r.commitSummary.committedRows} record(s) committed.`))} />
      )}
    </>
  );
}
