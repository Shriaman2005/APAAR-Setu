import { useState } from 'react';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import { ConfirmDialog } from '../../components/forms';
import { Alert, Button, DataState, DataTable, PageHeader, Pagination, StatusBadge, formatDate } from '../../components/ui';

/**
 * Audit explorer. Scope comes from the server (head: own institution; regional: own regions;
 * national/admin: all). Only national officers and administrators can run the chain verification.
 */
export default function AuditExplorerPage() {
  const { user } = useAuth();
  useDocumentTitle('Audit explorer');
  const canVerify = ['AICTE_NATIONAL_OFFICER', 'AICTE_SYSTEM_ADMIN'].includes(user.role);
  const [filters, setFilters] = useState({ action: '', entityType: '', entityRef: '', page: 1 });
  const [draft, setDraft] = useState({ action: '', entityType: '', entityRef: '' });
  const list = useApi(() => api(`/audit${toQuery(filters)}`), [filters]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const verify = useAction();

  async function runVerification() {
    const outcome = await verify.run(() => api('/audit/verify-chain', { method: 'POST' }), { onError: () => {} });
    if (outcome) { setResult(outcome); setConfirming(false); list.reload(); }
  }

  return (
    <>
      <PageHeader
        title={canVerify ? 'Audit explorer' : 'Audit history'}
        subtitle={user.role === 'COLLEGE_HEAD' ? 'Read-only timeline of your institution\'s submissions and certifications.' : 'Read-only, hash-chained audit events in your scope.'}
        onRefresh={list.reload}
        refreshing={list.loading}
        actions={canVerify && <Button icon="shield-check" onClick={() => setConfirming(true)}>Verify chain</Button>}
      />
      {result && (
        <Alert kind={result.status === 'PASS' ? 'success' : 'error'} className="mb-3" title={`Integrity check: ${result.status}`}>
          <div>{result.checkedEvents} event(s) checked at {formatDate(result.verifiedAt, true)} in {result.durationMs} ms. Chain head sequence: {result.headSequence}.</div>
          {result.status === 'FAIL' && (
            <>
              <div className="mt-1">First problem at sequence <strong>{result.firstFailureSequence}</strong> ({result.failureCount} finding(s)):</div>
              <ul className="mb-0">{result.failures.map((f) => <li key={`${f.sequence}-${f.problem}`}>#{f.sequence} {f.problem}: {f.detail}</li>)}</ul>
            </>
          )}
          <div className="small mt-2">{result.guarantee}</div>
        </Alert>
      )}
      <form className="row g-2 align-items-end mb-3" onSubmit={(e) => { e.preventDefault(); setFilters({ ...draft, action: draft.action.trim().toUpperCase(), page: 1 }); }}>
        <div className="col-sm-4 col-md-3"><label className="form-label" htmlFor="a-action">Action</label><input id="a-action" className="form-control" placeholder="e.g. BATCH_UPLOADED" value={draft.action} onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))} /></div>
        <div className="col-sm-4 col-md-3"><label className="form-label" htmlFor="a-type">Entity type</label><input id="a-type" className="form-control" placeholder="e.g. UploadBatch" value={draft.entityType} onChange={(e) => setDraft((d) => ({ ...d, entityType: e.target.value }))} /></div>
        <div className="col-sm-4 col-md-3"><label className="form-label" htmlFor="a-ref">Entity reference</label><input id="a-ref" className="form-control" value={draft.entityRef} onChange={(e) => setDraft((d) => ({ ...d, entityRef: e.target.value }))} /></div>
        <div className="col-12 col-md-3 d-flex gap-2"><Button type="submit" icon="funnel">Filter</Button><Button variant="link" onClick={() => { setDraft({ action: '', entityType: '', entityRef: '' }); setFilters({ action: '', entityType: '', entityRef: '', page: 1 }); }}>Clear filters</Button></div>
      </form>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No audit events match">
        {list.data && (
          <>
            <DataTable
              caption="Audit events"
              rowKey={(row) => row.sequence}
              columns={[
                { key: 'sequence', header: '#', numeric: true },
                { key: 'timestamp', header: 'Time', render: (row) => formatDate(row.timestamp, true) },
                { key: 'action', header: 'Action', render: (row) => <span className="mono">{row.action}</span> },
                { key: 'actor', header: 'Actor', render: (row) => <>{row.actorName}<div className="small text-muted">{row.actorRole}</div></> },
                { key: 'entity', header: 'Entity', render: (row) => <>{row.entityType}<div className="small mono">{row.entityRef}</div></> },
                { key: 'reason', header: 'Reason', render: (row) => row.reason || '-' },
                { key: 'hash', header: 'Hash (prefix)', render: (row) => <span className="mono" title={row.hash}>{row.hash.slice(0, 12)}…</span> },
              ]}
              rows={list.data.items}
            />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
          </>
        )}
      </DataState>
      {confirming && (
        <ConfirmDialog title="Verify audit chain" confirmLabel="Run verification" onConfirm={runVerification} onClose={() => { setConfirming(false); verify.setError(null); }} busy={verify.busy} error={verify.error}
          message="Recomputes every event hash and link. The result reports PASS only if every event was actually checked. The verification run itself is then recorded as a new audit event." />
      )}
      {result && <p className="small text-muted"><StatusBadge status={result.status} /> Last verification result shown above.</p>}
    </>
  );
}
