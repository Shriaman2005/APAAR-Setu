import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import Modal from '../../components/Modal';
import { ReasonDialog, SelectField } from '../../components/forms';
import { Alert, Button, DataState, DataTable, ErrorAlert, KeyValue, PageHeader, Pagination, StatusBadge, formatDate } from '../../components/ui';

const RULE_LABELS = {
  L7_SHARED_CONTACT: 'Shared contact token',
  L7_LATE_ADDITION: 'Late additions',
  L7_ADDITIONAL_BUCKET_RATIO: 'Unusual additional-bucket share',
};

export function RiskQueuePage() {
  useDocumentTitle('Risk queue');
  const [filters, setFilters] = useState({ status: 'OPEN_ALL', priority: '', assignedToMe: '', page: 1 });
  const list = useApi(() => api(`/risk-cases${toQuery(filters)}`), [filters]);
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value, page: 1 }));
  return (
    <>
      <PageHeader title="Risk queue" subtitle="Rule-based signals ordered by review priority. A score is not a probability of fraud and never triggers a penalty." onRefresh={list.reload} refreshing={list.loading} />
      <div className="row g-2 align-items-end mb-3">
        <div className="col-6 col-md-3">
          <label className="form-label" htmlFor="r-status">Status</label>
          <select id="r-status" className="form-select" value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="OPEN_ALL">All open</option><option value="OPEN">Open (unassigned)</option><option value="ASSIGNED">Assigned</option><option value="ESCALATED">Escalated</option>
            <option value="REVIEWED">Reviewed</option><option value="FALSE_POSITIVE">False positive</option><option value="">Any</option>
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label" htmlFor="r-priority">Priority</label>
          <select id="r-priority" className="form-select" value={filters.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="">Any</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
          </select>
        </div>
        <div className="col-12 col-md-3 form-check ms-2">
          <input id="r-mine" type="checkbox" className="form-check-input" checked={filters.assignedToMe === 'true'} onChange={(e) => set('assignedToMe', e.target.checked ? 'true' : '')} />
          <label className="form-check-label" htmlFor="r-mine">Assigned to me</label>
        </div>
      </div>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No risk cases match">
        {list.data && (
          <>
            <DataTable
              caption="Risk cases"
              rowKey={(row) => row.riskCaseId}
              columns={[
                { key: 'riskCaseId', header: 'Case', render: (row) => <Link to={`/aicte/risk/${row.riskCaseId}`}>{row.riskCaseId}</Link> },
                { key: 'institution', header: 'Institution', render: (row) => <>{row.institutionName}<div className="small text-muted">{row.institutionCode} - {row.regionId}</div></> },
                { key: 'ruleCode', header: 'Signal', render: (row) => RULE_LABELS[row.ruleCode] || row.ruleCode },
                { key: 'score', header: 'Priority score', numeric: true },
                { key: 'priority', header: 'Priority', render: (row) => <StatusBadge status={row.priority} /> },
                { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
                { key: 'lastEvaluatedAt', header: 'Last evaluated', render: (row) => formatDate(row.lastEvaluatedAt, true) },
              ]}
              rows={list.data.items}
            />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
          </>
        )}
      </DataState>
    </>
  );
}

function AssignDialog({ riskCaseId, onClose, onDone }) {
  const officers = useApi(() => api(`/risk-cases/${riskCaseId}/assignees`), [riskCaseId]);
  const [assigneeId, setAssigneeId] = useState('');
  const action = useAction();
  async function submit() {
    const done = await action.run(() => api(`/risk-cases/${riskCaseId}/assign`, { method: 'POST', body: { assigneeId } }), { success: 'Reviewer assigned and notified.', onError: () => {} });
    if (done) onDone();
  }
  return (
    <Modal title="Assign reviewer" onClose={onClose} busy={action.busy} footer={(
      <>
        <Button onClick={submit} loading={action.busy} disabled={!assigneeId} disabledReason="Choose an officer first.">Assign</Button>
        <Button variant="outline-primary" onClick={onClose} disabled={action.busy}>Cancel</Button>
      </>
    )}>
      <DataState loading={officers.loading} error={officers.error} onRetry={officers.reload} hasData={Boolean(officers.data)} empty={officers.data?.items.length === 0} emptyTitle="No eligible officers">
        {officers.data && (
          <SelectField label="Officer (only officers inside this case's scope are listed)" value={assigneeId} onChange={setAssigneeId} placeholder="Choose an officer" required
            options={officers.data.items.map((o) => ({ value: o.id, label: `${o.displayName} - ${o.role === 'AICTE_NATIONAL_OFFICER' ? 'National' : `Regional (${o.regionIds.join(', ')})`}` }))} />
        )}
      </DataState>
      <ErrorAlert error={action.error} />
    </Modal>
  );
}

const CLOSE_ACTIONS = {
  ADD_NOTE: { title: 'Add note', label: 'Note', path: 'notes', field: 'text', min: 3, variant: 'primary', success: 'Note added.' },
  MARK_REVIEWED: { title: 'Mark reviewed', label: 'Review summary (required)', path: 'review', field: 'summary', min: 10, variant: 'success', success: 'Case marked reviewed.', help: 'Completing a review does not imply any finding of wrongdoing.' },
  MARK_FALSE_POSITIVE: { title: 'Mark false positive', label: 'Reason', path: 'false-positive', field: 'reason', min: 10, variant: 'primary', success: 'Marked false positive. The original signal is kept for tuning.', help: 'The original signal and evidence are kept; nothing is deleted.' },
  ESCALATE: { title: 'Escalate case', label: 'Reason for escalation', path: 'escalate', field: 'reason', min: 10, variant: 'danger', success: 'Case escalated; national officers notified.', help: 'Escalation asks for a national-level look. It does not determine wrongdoing.' },
};

export function RiskCaseDetailPage() {
  const { riskCaseId } = useParams();
  useDocumentTitle(`Risk case ${riskCaseId}`);
  const item = useApi(() => api(`/risk-cases/${riskCaseId}`), [riskCaseId]);
  const [pending, setPending] = useState(null);
  const action = useAction();

  async function submit(text) {
    const config = CLOSE_ACTIONS[pending];
    const done = await action.run(() => api(`/risk-cases/${riskCaseId}/${config.path}`, { method: 'POST', body: { [config.field]: text } }), { success: config.success, onError: () => {} });
    if (done) { setPending(null); item.reload(); }
  }

  const data = item.data;
  return (
    <>
      <PageHeader title={`Risk case ${riskCaseId}`} breadcrumbs={[{ label: 'Risk queue', to: '/aicte/risk' }, { label: riskCaseId }]} onRefresh={item.reload} refreshing={item.loading} />
      <DataState loading={item.loading} error={item.error} onRetry={item.reload} hasData={Boolean(data)}>
        {data && (
          <>
            <Alert kind="warning" className="mb-3">{data.notice}</Alert>
            <div className="row g-3">
              <div className="col-lg-5">
                <section className="card-gov">
                  <h2>Signal</h2>
                  <KeyValue items={[
                    ['Signal', RULE_LABELS[data.ruleCode] || data.ruleCode],
                    ['Institution', `${data.institution.name} (${data.institution.code})`],
                    ['Region / year', `${data.regionId} / ${data.academicYear}`],
                    ['Priority score', `${data.score} / 100`],
                    ['Priority', <StatusBadge key="p" status={data.priority} />],
                    ['How the score is computed', data.scoringFormula],
                    ['Ruleset version', data.rulesetVersion],
                    ['Status', <StatusBadge key="s" status={data.status} />],
                    ['Assigned to', data.assignedToName || 'Unassigned'],
                  ]} />
                </section>
                <section className="card-gov">
                  <h2>Actions</h2>
                  <div className="d-flex flex-wrap gap-2">
                    {data.availableActions.includes('ASSIGN') && <Button variant="outline-primary" icon="person-plus" onClick={() => setPending('ASSIGN')}>Assign reviewer</Button>}
                    {data.availableActions.includes('ADD_NOTE') && <Button variant="outline-primary" icon="sticky" onClick={() => setPending('ADD_NOTE')}>Add note</Button>}
                    {data.availableActions.includes('MARK_REVIEWED') && <Button variant="success" icon="check2-circle" onClick={() => setPending('MARK_REVIEWED')}>Mark reviewed</Button>}
                    {data.availableActions.includes('MARK_FALSE_POSITIVE') && <Button variant="outline-primary" icon="hand-thumbs-down" onClick={() => setPending('MARK_FALSE_POSITIVE')}>Mark false positive</Button>}
                    {data.availableActions.includes('ESCALATE') && <Button variant="outline-danger" icon="arrow-up-circle" onClick={() => setPending('ESCALATE')}>Escalate</Button>}
                  </div>
                  {!data.isOpen && <p className="small text-muted mt-2 mb-0">This case is closed; notes can still be added.</p>}
                </section>
              </div>
              <div className="col-lg-7">
                <section className="card-gov">
                  <h2>Reasons</h2>
                  <ul>{data.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  <h3>Evidence (current snapshot)</h3>
                  <pre className="mono bg-light p-2 border rounded small mb-2" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data.evidence, null, 2)}</pre>
                  <p className="small text-muted mb-0">{data.evidenceHistory.length} evidence snapshot(s) kept since first detection. Student references are masked.</p>
                </section>
                <section className="card-gov">
                  <h2>Notes and history</h2>
                  {data.review && <Alert kind="success" className="mb-2" title={`Reviewed by ${data.review.byName}`}>{data.review.summary}</Alert>}
                  {data.falsePositive && <Alert kind="info" className="mb-2" title={`False positive (${data.falsePositive.byName})`}>{data.falsePositive.reason}</Alert>}
                  {data.escalation && <Alert kind="warning" className="mb-2" title={`Escalated by ${data.escalation.byName}`}>{data.escalation.reason}</Alert>}
                  {data.notes.length > 0 && (
                    <ul className="list-unstyled">{data.notes.map((note) => <li key={note.at} className="mb-2"><strong>{note.byName}</strong> <span className="small text-muted">{formatDate(note.at, true)}</span><div>{note.text}</div></li>)}</ul>
                  )}
                  <ol className="timeline">{data.events.map((event) => <li key={`${event.type}-${event.at}`}><strong>{event.type.replaceAll('_', ' ').toLowerCase()}</strong> - {event.byName || 'System'} <span className="small text-muted">{formatDate(event.at, true)}</span><div className="small">{event.message}</div></li>)}</ol>
                </section>
              </div>
            </div>
          </>
        )}
      </DataState>
      {pending === 'ASSIGN' && <AssignDialog riskCaseId={riskCaseId} onClose={() => setPending(null)} onDone={() => { setPending(null); item.reload(); }} />}
      {pending && pending !== 'ASSIGN' && (
        <ReasonDialog title={CLOSE_ACTIONS[pending].title} label={CLOSE_ACTIONS[pending].label} description={CLOSE_ACTIONS[pending].help} minLength={CLOSE_ACTIONS[pending].min}
          variant={CLOSE_ACTIONS[pending].variant} confirmLabel="Save" onSubmit={submit} onClose={() => { setPending(null); action.setError(null); }} busy={action.busy} error={action.error} />
      )}
    </>
  );
}
