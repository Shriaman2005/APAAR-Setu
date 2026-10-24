import { useState } from 'react';
import { api, toQuery } from '../../../services/apiClient';
import { useAction, useApi } from '../../../hooks/useApi';
import { ReasonDialog } from '../../../components/forms';
import { Button, DataState, Pagination, StatusBadge } from '../../../components/ui';

const SEVERITIES = ['ERROR', 'WARNING', 'PENDING', 'INFO', 'RISK_FLAG'];
const STATUSES = ['OPEN', 'JUSTIFIED', 'ACCEPTED', 'RESOLVED', 'SUPERSEDED'];

/**
 * Validation issues grid. Filters never hide blockers from the summary counts above it.
 * Operator: justify warnings. Head: accept justified dispositions (selected rows).
 */
export default function IssuesPanel({ batchId, permissions, isHead, refreshKey, onChanged, onOpenRow }) {
  const [filters, setFilters] = useState({ severity: '', status: '', layer: '', needsAction: '', view: 'current', page: 1 });
  const list = useApi(() => api(`/batches/${batchId}/issues${toQuery(filters)}`), [batchId, filters, refreshKey]);
  const [justifying, setJustifying] = useState(null);
  const [selected, setSelected] = useState([]);
  const [accepting, setAccepting] = useState(false);
  const action = useAction();

  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const acceptable = (list.data?.items || []).filter((issue) => issue.current && issue.dispositionRequired && issue.resolutionStatus === 'JUSTIFIED');

  async function submitJustification(text) {
    const done = await action.run(() => api(`/batches/${batchId}/issues/${justifying.id}/justify`, { method: 'POST', body: { justification: text } }), { success: 'Justification recorded for the college head.' });
    if (done) { setJustifying(null); list.reload(); onChanged(); }
  }

  async function submitAcceptance(reason) {
    const done = await action.run(() => api(`/batches/${batchId}/dispositions`, { method: 'POST', body: { issueIds: selected, reason } }), { success: (r) => `${r.accepted} disposition(s) accepted.` });
    if (done) { setAccepting(false); setSelected([]); list.reload(); onChanged(); }
  }

  return (
    <>
      <div className="row g-2 align-items-end mb-2">
        <div className="col-6 col-md-2">
          <label className="form-label small" htmlFor="f-sev">Severity</label>
          <select id="f-sev" className="form-select" value={filters.severity} onChange={(e) => setFilter('severity', e.target.value)}>
            <option value="">All</option>{SEVERITIES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small" htmlFor="f-status">Resolution</label>
          <select id="f-status" className="form-select" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small" htmlFor="f-layer">Layer</label>
          <select id="f-layer" className="form-select" value={filters.layer} onChange={(e) => setFilter('layer', e.target.value)}>
            <option value="">All</option>{['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small" htmlFor="f-view">Show</label>
          <select id="f-view" className="form-select" value={filters.view} onChange={(e) => setFilter('view', e.target.value)}>
            <option value="current">Current results</option>
            <option value="history">History (resolved/superseded)</option>
          </select>
        </div>
        <div className="col-12 col-md-4 d-flex flex-wrap gap-2 align-items-center">
          <div className="form-check mb-0">
            <input id="f-action" type="checkbox" className="form-check-input" checked={filters.needsAction === 'true'} onChange={(e) => setFilter('needsAction', e.target.checked ? 'true' : '')} />
            <label className="form-check-label small" htmlFor="f-action">Needs action only</label>
          </div>
          <Button variant="link" size="sm" onClick={() => setFilters({ severity: '', status: '', layer: '', needsAction: '', view: 'current', page: 1 })}>Clear filters</Button>
        </div>
      </div>

      {isHead && permissions.canAcceptDispositions && (
        <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
          <Button variant="success" icon="check2-all" disabled={selected.length === 0} disabledReason="Select justified warnings first." onClick={() => setAccepting(true)}>Accept selected dispositions ({selected.length})</Button>
          {acceptable.length > 0 && <Button variant="link" size="sm" onClick={() => setSelected(acceptable.map((i) => i.id))}>Select all justified on this page</Button>}
        </div>
      )}

      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle={filters.view === 'history' ? 'No earlier results' : 'No issues match these filters'}>
        {list.data && (
          <div className="table-responsive" style={{ maxHeight: '60vh' }}>
            <table className="table table-gov align-middle">
              <caption className="visually-hidden">Validation issues</caption>
              <thead>
                <tr>
                  {isHead && permissions.canAcceptDispositions && <th scope="col"><span className="visually-hidden">Select</span></th>}
                  <th scope="col">Row</th><th scope="col">Layer / rule</th><th scope="col">Severity</th><th scope="col">What happened and how to fix it</th><th scope="col">Status</th><th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((issue) => (
                  <tr key={issue.id}>
                    {isHead && permissions.canAcceptDispositions && (
                      <td>
                        {issue.current && issue.dispositionRequired && issue.resolutionStatus === 'JUSTIFIED' && (
                          <input type="checkbox" className="form-check-input" aria-label={`Select issue on row ${issue.rowNumber}`} checked={selected.includes(issue.id)}
                            onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, issue.id] : cur.filter((id) => id !== issue.id)))} />
                        )}
                      </td>
                    )}
                    <td className="text-nowrap">{issue.rowNumber === null ? 'Batch' : <Button variant="link" size="sm" className="text-nowrap" onClick={() => onOpenRow(issue.rowNumber)}>Row {issue.rowNumber}</Button>}</td>
                    <td style={{ minWidth: 190 }}><span className="mono">{issue.layer}</span><div className="small">{issue.ruleTitle}</div><div className="small text-muted mono">{issue.ruleCode}</div></td>
                    <td><StatusBadge status={issue.severity} />{issue.blocking && <div className="small text-danger">blocks submission</div>}</td>
                    <td style={{ minWidth: 280 }}>
                      <div>{issue.message}</div>
                      <div className="small text-muted">Fix: {issue.correctionHint}</div>
                      {issue.justification && <div className="small mt-1"><strong>Operator justification:</strong> {issue.justification.text}</div>}
                      {issue.disposition && <div className="small"><strong>Head decision:</strong> accepted - {issue.disposition.reason}</div>}
                      {issue.resolutionReason && <div className="small text-muted">{issue.resolutionReason}</div>}
                    </td>
                    <td><StatusBadge status={issue.resolutionStatus} /></td>
                    <td>
                      {permissions.canJustify && issue.current && issue.dispositionRequired && issue.resolutionStatus === 'OPEN' && (
                        <Button size="sm" variant="outline-primary" icon="chat-left-text" onClick={() => setJustifying(issue)}>Justify</Button>
                      )}
                      {issue.severity === 'ERROR' && issue.current && <span className="small text-muted">Correct or exclude the row</span>}
                      {issue.severity === 'RISK_FLAG' && <span className="small text-muted">For review only</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={list.data?.page} totalPages={list.data?.totalPages} total={list.data?.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
      </DataState>

      {justifying && (
        <ReasonDialog
          title={`Justify: row ${justifying.rowNumber}`}
          description={justifying.message}
          label="Justification for the college head"
          confirmLabel="Save justification"
          onSubmit={submitJustification}
          onClose={() => { setJustifying(null); action.setError(null); }}
          busy={action.busy}
          error={action.error}
        />
      )}
      {accepting && (
        <ReasonDialog
          title={`Accept ${selected.length} warning disposition(s)`}
          description="Only warnings whose policy allows a documented disposition can be accepted. Blocking errors can never be accepted."
          label="Reason for accepting"
          confirmLabel="Accept dispositions"
          variant="success"
          onSubmit={submitAcceptance}
          onClose={() => { setAccepting(false); action.setError(null); }}
          busy={action.busy}
          error={action.error}
        />
      )}
    </>
  );
}
