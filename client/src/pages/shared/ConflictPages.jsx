import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import { ReasonDialog } from '../../components/forms';
import { Alert, Button, DataState, DataTable, KeyValue, PageHeader, Pagination, StatusBadge, formatDate } from '../../components/ui';

function basePath(role) {
  return role.startsWith('COLLEGE') ? '/college/conflicts' : '/aicte/conflicts';
}

export function ConflictListPage() {
  const { user } = useAuth();
  useDocumentTitle('Conflict cases');
  const [filters, setFilters] = useState({ status: 'OPEN_ALL', escalationLevel: '', page: 1 });
  const list = useApi(() => api(`/conflicts${toQuery(filters)}`), [filters]);
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value, page: 1 }));
  return (
    <>
      <PageHeader title={user.role.startsWith('COLLEGE') ? 'Conflict cases' : 'Conflict monitor'} subtitle="Candidate cross-college conflicts. A case is a request for review - never a finding of fraud." onRefresh={list.reload} refreshing={list.loading} />
      <div className="row g-2 mb-3">
        <div className="col-sm-4 col-md-3">
          <label className="form-label" htmlFor="c-status">Status</label>
          <select id="c-status" className="form-select" value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="OPEN_ALL">All open</option><option value="OPEN">Open</option><option value="AWAITING_REVIEW">Awaiting review</option><option value="RESOLVED">Resolved</option><option value="">Any</option>
          </select>
        </div>
        <div className="col-sm-4 col-md-3">
          <label className="form-label" htmlFor="c-level">Level</label>
          <select id="c-level" className="form-select" value={filters.escalationLevel} onChange={(e) => set('escalationLevel', e.target.value)}>
            <option value="">Any</option><option value="REGIONAL">Regional</option><option value="NATIONAL">Escalated to national</option>
          </select>
        </div>
      </div>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No conflict cases match">
        {list.data && (
          <>
            <DataTable
              caption="Conflict cases"
              rowKey={(row) => row.conflictId}
              columns={[
                { key: 'conflictId', header: 'Case', render: (row) => <Link to={`${basePath(user.role)}/${row.conflictId}`}>{row.conflictId}</Link> },
                { key: 'studentRefMasked', header: 'Student (masked)', render: (row) => <span className="mono">{row.studentRefMasked}</span> },
                { key: 'institutions', header: 'Institutions', render: (row) => row.institutions.join(', ') },
                { key: 'academicYear', header: 'Year' },
                { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
                { key: 'escalationLevel', header: 'Level' },
                { key: 'dueAt', header: 'Review target', render: (row) => <>{formatDate(row.dueAt)}{row.overdue && <span className="d-block"><StatusBadge status="ESCALATED" label="Overdue" /></span>}</> },
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

const ACTION_LABELS = {
  SUBMIT_FACTS: { label: 'Submit facts / evidence note', variant: 'outline-primary', help: 'Adds your institution\'s response to the case history. It does not change any record.' },
  WITHDRAW_OWN_ENROLMENT: { label: 'Withdraw our enrolment', variant: 'outline-danger', help: 'Your enrolment becomes WITHDRAWN and its seat is released. The case closes if only one active enrolment remains.' },
  TRANSFER_OWN_ENROLMENT: { label: 'Mark our enrolment transferred', variant: 'outline-danger', help: 'Your enrolment becomes TRANSFERRED (destination recorded) and its seat is released.' },
  SUBMIT_JUSTIFICATION: { label: 'Justify both enrolments', variant: 'outline-primary', help: 'Sends a justification to AICTE reviewers. The case stays open until an officer accepts it.' },
  ACCEPT_JUSTIFICATION: { label: 'Accept justification', variant: 'success', help: 'Closes the case as JUSTIFIED. Both enrolments stay active.' },
  REJECT_JUSTIFICATION: { label: 'Reject justification', variant: 'outline-danger', help: 'Reopens the case so the institutions must resolve it.' },
  ADD_NOTE: { label: 'Add note', variant: 'outline-primary', help: 'Appends a reviewer note to the case history.' },
  ESCALATE: { label: 'Escalate to national level', variant: 'outline-danger', help: 'Records an escalation and notifies national officers. Escalation does not determine wrongdoing.' },
};

export function ConflictDetailPage() {
  const { conflictId } = useParams();
  const { user } = useAuth();
  useDocumentTitle(`Conflict ${conflictId}`);
  const conflict = useApi(() => api(`/conflicts/${conflictId}`), [conflictId]);
  const [pending, setPending] = useState(null);
  const action = useAction();

  async function submit(reason) {
    const request = pending === 'ESCALATE'
      ? () => api(`/conflicts/${conflictId}/escalate`, { method: 'POST', body: { reason } })
      : () => api(`/conflicts/${conflictId}/resolve`, { method: 'POST', body: { action: pending, reason } });
    const done = await action.run(request, { success: 'Case updated.', onError: () => {} });
    if (done) { setPending(null); conflict.reload(); }
  }

  const data = conflict.data;
  return (
    <>
      <PageHeader title={`Conflict case ${conflictId}`} breadcrumbs={[{ label: 'Conflicts', to: basePath(user.role) }, { label: conflictId }]} onRefresh={conflict.reload} refreshing={conflict.loading} />
      <DataState loading={conflict.loading} error={conflict.error} onRetry={conflict.reload} hasData={Boolean(data)}>
        {data && (
          <>
            <Alert kind="info" className="mb-3">{data.notice}</Alert>
            <div className="row g-3">
              <div className="col-lg-5">
                <section className="card-gov">
                  <h2>Case summary</h2>
                  <KeyValue items={[
                    ['Status', <StatusBadge key="s" status={data.status} />],
                    ['Type', data.conflictType.replaceAll('_', ' ').toLowerCase()],
                    ['Academic year', data.academicYear],
                    ['Student', data.student.displayName ? `${data.student.displayName} (${data.student.studentCode})` : <span key="m"><span className="mono">{data.student.studentRefMasked}</span> ({data.student.initials})</span>],
                    ['Review level', data.escalationLevel],
                    ['Review target', <span key="d">{formatDate(data.dueAt)} {data.overdue && <StatusBadge status="ESCALATED" label="Overdue" />}</span>],
                    data.justification && ['Justification', `${data.justification.text} (${formatDate(data.justification.at, true)})`],
                    data.resolution && ['Resolution', `${data.resolution.type} - ${data.resolution.reason}`],
                  ]} />
                </section>
                <section className="card-gov">
                  <h2>Actions</h2>
                  {data.availableActions.length === 0 ? <p className="text-muted mb-0">No actions are available to you for this case{data.isOpen ? '' : ' because it is resolved'}.</p> : (
                    <div className="d-flex flex-column gap-2">
                      {data.availableActions.map((key) => (
                        <div key={key}>
                          <Button variant={ACTION_LABELS[key].variant} onClick={() => setPending(key)}>{ACTION_LABELS[key].label}</Button>
                          <div className="small text-muted">{ACTION_LABELS[key].help}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
              <div className="col-lg-7">
                <section className="card-gov">
                  <h2>Enrolments involved</h2>
                  <DataTable
                    rowKey={(row) => `${row.institutionCode}-${row.state}`}
                    columns={[
                      { key: 'institution', header: 'Institution', render: (row) => <>{row.institutionName} ({row.institutionCode}){row.isOwnSide && <span className="d-block small fw-semibold">Your institution</span>}</> },
                      { key: 'regionId', header: 'Region' },
                      { key: 'details', header: 'Course / year', render: (row) => (row.courseCode ? `${row.courseCode} / Y${row.yearOfStudy}` : 'Hidden (other institution)') },
                      { key: 'state', header: 'State', render: (row) => <StatusBadge status={row.state} /> },
                    ]}
                    rows={data.sides}
                  />
                </section>
                <section className="card-gov">
                  <h2>Case history</h2>
                  <ol className="timeline">
                    {data.events.map((event) => (
                      <li key={`${event.type}-${event.at}`}>
                        <strong>{event.type.replaceAll('_', ' ').toLowerCase()}</strong> - {event.actorName} <span className="small text-muted">({formatDate(event.at, true)})</span>
                        {event.message && <div className="small">{event.message}</div>}
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </div>
          </>
        )}
      </DataState>
      {pending && (
        <ReasonDialog
          title={ACTION_LABELS[pending].label}
          description={ACTION_LABELS[pending].help}
          label={pending === 'SUBMIT_FACTS' || pending === 'ADD_NOTE' ? 'Text' : 'Reason / justification'}
          variant={ACTION_LABELS[pending].variant.includes('danger') ? 'danger' : 'primary'}
          confirmLabel="Submit"
          onSubmit={submit}
          onClose={() => { setPending(null); action.setError(null); }}
          busy={action.busy}
          error={action.error}
        />
      )}
    </>
  );
}
