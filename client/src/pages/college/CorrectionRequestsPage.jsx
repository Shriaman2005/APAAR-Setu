import { useState } from 'react';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import { ReasonDialog } from '../../components/forms';
import { Button, DataState, DataTable, PageHeader, Pagination, StatusBadge, formatDate } from '../../components/ui';

// Student correction requests for this institution. Only the head decides; the official record
// changes only when a NAME_CORRECTION is accepted.
export default function CorrectionRequestsPage() {
  const { user } = useAuth();
  useDocumentTitle('Student correction requests');
  const [filters, setFilters] = useState({ status: 'SUBMITTED', page: 1 });
  const list = useApi(() => api(`/correction-requests${toQuery(filters)}`), [filters]);
  const [deciding, setDeciding] = useState(null);
  const action = useAction();

  async function decide(response) {
    const done = await action.run(() => api(`/correction-requests/${deciding.item.correctionRequestId}/decision`, { method: 'POST', body: { decision: deciding.decision, response } }), {
      success: deciding.decision === 'ACCEPT' ? 'Request accepted.' : 'Request rejected.', onError: () => {},
    });
    if (done) { setDeciding(null); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Student correction requests" subtitle={user.role === 'COLLEGE_HEAD' ? 'Review requests from your students. The official record stays unchanged until you accept.' : 'Requests are decided by the college head.'} onRefresh={list.reload} refreshing={list.loading} />
      <div className="col-sm-4 col-md-3 mb-3">
        <label className="form-label" htmlFor="cr-status">Status</label>
        <select id="cr-status" className="form-select" value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: 1 })}>
          <option value="SUBMITTED">Awaiting decision</option><option value="ACCEPTED">Accepted</option><option value="REJECTED">Rejected</option><option value="">All</option>
        </select>
      </div>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No correction requests">
        {list.data && (
          <>
            <DataTable
              caption="Correction requests"
              rowKey={(row) => row.correctionRequestId}
              columns={[
                { key: 'student', header: 'Student', render: (row) => <>{row.student.displayName}<div className="small text-muted">{row.student.studentCode}</div></> },
                { key: 'correctionType', header: 'Type', render: (row) => <>{row.correctionType.replace('_', ' ').toLowerCase()}{row.proposedValue && <div className="small">Proposed: “{row.proposedValue}”</div>}</> },
                { key: 'explanation', header: 'Explanation and evidence', render: (row) => <>{row.explanation}{row.evidenceNote && <div className="small text-muted">Evidence: {row.evidenceNote}</div>}</> },
                { key: 'status', header: 'Status', render: (row) => <><StatusBadge status={row.status} />{row.decision && <div className="small">{row.decision.response}</div>}</> },
                { key: 'createdAt', header: 'Submitted', render: (row) => formatDate(row.createdAt, true) },
                { key: 'actions', header: 'Decision', render: (row) => (row.canDecide ? (
                  <div className="d-flex gap-1">
                    <Button size="sm" variant="success" onClick={() => setDeciding({ item: row, decision: 'ACCEPT' })}>Accept</Button>
                    <Button size="sm" variant="outline-danger" onClick={() => setDeciding({ item: row, decision: 'REJECT' })}>Reject</Button>
                  </div>
                ) : '-') },
              ]}
              rows={list.data.items}
            />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
          </>
        )}
      </DataState>
      {deciding && (
        <ReasonDialog
          title={`${deciding.decision === 'ACCEPT' ? 'Accept' : 'Reject'} correction request`}
          description={deciding.decision === 'ACCEPT' && deciding.item.correctionType === 'NAME_CORRECTION'
            ? `The register name will change to “${deciding.item.proposedValue}”. The previous name is kept in the history.`
            : deciding.decision === 'ACCEPT' ? 'Accepting records the outcome; corrected enrolment details must come through a certified batch or a lifecycle change.' : 'The student will see your response.'}
          label="Response to the student" minLength={5} variant={deciding.decision === 'ACCEPT' ? 'success' : 'danger'} confirmLabel="Save decision"
          onSubmit={decide} onClose={() => { setDeciding(null); action.setError(null); }} busy={action.busy} error={action.error}
        />
      )}
    </>
  );
}
