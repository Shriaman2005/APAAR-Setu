import { useState } from 'react';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import Modal from '../../components/Modal';
import { ReasonDialog } from '../../components/forms';
import { Alert, Button, DataState, DataTable, KeyValue, PageHeader, Pagination, StatusBadge, formatDate } from '../../components/ui';

const STATES = ['PROVISIONAL', 'CONFIRMED', 'WITHDRAWN', 'TRANSFERRED', 'COMPLETED', 'DROPPED'];

function EnrolmentDetail({ enrolmentRef, onClose, onChanged }) {
  const { user } = useAuth();
  const detail = useApi(() => api(`/enrolments/${enrolmentRef}`), [enrolmentRef]);
  const [target, setTarget] = useState(null);
  const action = useAction();

  async function change(reason) {
    const done = await action.run(() => api(`/enrolments/${enrolmentRef}/state`, { method: 'PATCH', body: { toState: target, reason } }), {
      success: (r) => `Enrolment moved to ${r.state}${r.seatEffect === 'RELEASE' ? '; the seat was released' : ''}.`, onError: () => {},
    });
    if (done) { setTarget(null); detail.reload(); onChanged(); }
  }

  const data = detail.data;
  return (
    <Modal title={`Enrolment ${enrolmentRef}`} size="lg" onClose={onClose} footer={<Button variant="outline-primary" onClick={onClose}>Close</Button>}>
      <DataState loading={detail.loading} error={detail.error} onRetry={detail.reload} hasData={Boolean(data)}>
        {data && (
          <>
            <KeyValue items={[
              ['Student', `${data.student.displayName} (${data.student.studentCode})`],
              ['Identity link (mock)', <StatusBadge key="i" status={data.student.externalLinkStatus} />],
              ['Programme', `${data.course.programName} (${data.enrolment.courseCode})`],
              ['Academic year / year of study', `${data.enrolment.academicYear} / ${data.enrolment.yearOfStudy}`],
              ['Bucket', data.enrolment.bucketCode],
              ['State', <StatusBadge key="s" status={data.enrolment.state} />],
              ['Holds a seat', data.enrolment.seatHeld ? 'Yes' : 'No'],
              ['Admitted on', formatDate(data.enrolment.admittedOn)],
              ['Source batch', data.enrolment.sourceBatchId],
            ]} />
            <h3 className="mt-3">Lifecycle history</h3>
            <ol className="timeline">
              {data.enrolment.history.map((h) => (
                <li key={`${h.toState}-${h.at}`}>{h.fromState ? `${h.fromState} → ` : ''}<strong>{h.toState}</strong> (seat: {h.seatEffect.toLowerCase()}) - {h.reason} <span className="small text-muted">{formatDate(h.at, true)}</span></li>
              ))}
            </ol>
            {user.role === 'COLLEGE_HEAD' && (
              data.allowedTransitions.length > 0 ? (
                <div className="d-flex flex-wrap gap-2">
                  {data.allowedTransitions.map((state) => (
                    <Button key={state} size="sm" variant={state === 'CONFIRMED' ? 'success' : 'outline-danger'} onClick={() => setTarget(state)}>Mark {state.toLowerCase()}</Button>
                  ))}
                </div>
              ) : <Alert kind="info">This enrolment is in a final state; no further changes are allowed.</Alert>
            )}
            {user.role === 'COLLEGE_OPERATOR' && <p className="small text-muted mt-2 mb-0">Only the college head can change an official enrolment state.</p>}
          </>
        )}
      </DataState>
      {target && (
        <ReasonDialog title={`Change state to ${target}`} confirmLabel="Change state" variant={target === 'CONFIRMED' ? 'success' : 'danger'}
          description={target === 'CONFIRMED' ? 'The enrolment keeps its seat.' : 'The seat is released exactly once and the change is kept in the history.'}
          onSubmit={change} onClose={() => { setTarget(null); action.setError(null); }} busy={action.busy} error={action.error} />
      )}
    </Modal>
  );
}

export default function RegisterPage() {
  const { user } = useAuth();
  const isCollege = user.role.startsWith('COLLEGE');
  useDocumentTitle('Student register');
  const [filters, setFilters] = useState({ state: '', academicYear: '2026-27', courseCode: '', search: '', page: 1 });
  const [searchText, setSearchText] = useState('');
  const [open, setOpen] = useState(null);
  const list = useApi(() => api(`/enrolments${toQuery(filters)}`), [filters]);
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value, page: 1 }));

  return (
    <>
      <PageHeader title="Student register" subtitle={isCollege ? 'Official enrolments of your institution.' : 'Enrolments in your scope. Student identities are masked by default.'} onRefresh={list.reload} refreshing={list.loading} />
      <form className="row g-2 align-items-end mb-3" onSubmit={(e) => { e.preventDefault(); set('search', searchText.trim()); }}>
        <div className="col-6 col-md-2">
          <label className="form-label" htmlFor="reg-state">State</label>
          <select id="reg-state" className="form-select" value={filters.state} onChange={(e) => set('state', e.target.value)}>
            <option value="">All</option>{STATES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label" htmlFor="reg-year">Academic year</label>
          <select id="reg-year" className="form-select" value={filters.academicYear} onChange={(e) => set('academicYear', e.target.value)}>
            <option value="2026-27">2026-27</option><option value="">All</option>
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label" htmlFor="reg-course">Course code</label>
          <input id="reg-course" className="form-control" value={filters.courseCode} onChange={(e) => set('courseCode', e.target.value.toUpperCase())} />
        </div>
        {isCollege && (
          <div className="col-6 col-md-3">
            <label className="form-label" htmlFor="reg-search">Student code or name</label>
            <input id="reg-search" className="form-control" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </div>
        )}
        <div className="col-12 col-md-3 d-flex gap-2">
          {isCollege && <Button type="submit" icon="search">Search</Button>}
          <Button variant="link" onClick={() => { setSearchText(''); setFilters({ state: '', academicYear: '2026-27', courseCode: '', search: '', page: 1 }); }}>Clear filters</Button>
        </div>
      </form>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No enrolments match">
        {list.data && (
          <>
            <DataTable
              caption="Enrolments"
              rowKey={(row) => row.enrolmentRef}
              columns={[
                { key: 'student', header: 'Student', render: (row) => (isCollege ? <>{row.student.displayName}<div className="small text-muted">{row.student.studentCode}</div></> : <>{row.student.initials}<div className="small text-muted mono">{row.student.studentRefMasked}</div></>) },
                !isCollege && { key: 'institutionCode', header: 'Institution' },
                { key: 'courseCode', header: 'Course' },
                { key: 'academicYear', header: 'Year', render: (row) => `${row.academicYear} (Y${row.yearOfStudy})` },
                isCollege && { key: 'bucketCode', header: 'Bucket' },
                { key: 'state', header: 'State', render: (row) => <StatusBadge status={row.state} /> },
                isCollege && { key: 'open', header: 'Details', render: (row) => <Button size="sm" variant="outline-primary" onClick={() => setOpen(row.enrolmentRef)}>Open</Button> },
              ].filter(Boolean)}
              rows={list.data.items}
            />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
          </>
        )}
      </DataState>
      {open && <EnrolmentDetail enrolmentRef={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </>
  );
}
