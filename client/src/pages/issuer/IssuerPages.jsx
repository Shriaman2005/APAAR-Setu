import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadFile, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { ConfirmDialog, ReasonDialog } from '../../components/forms';
import { Alert, Button, DataState, DataTable, KeyValue, KpiTile, PageHeader, Pagination, StatusBadge, SyntheticTag, formatDate } from '../../components/ui';
import { CredentialPanel } from '../shared/CredentialPanel';

export function IssuerWorkspace() {
  useDocumentTitle('Certificate workspace');
  const summary = useApi(() => api('/dashboard/issuer'), []);
  const [query, setQuery] = useState({ search: '', page: 1 });
  const [text, setText] = useState('');
  const results = useApi(() => api(`/issuer/eligible-students${toQuery(query)}`), [query]);
  return (
    <>
      <PageHeader title="Certificate workspace" subtitle={summary.data ? `${summary.data.organisation.name} - issuer scope: ${summary.data.affiliatedInstitutions.map((i) => i.code).join(', ')}` : null} onRefresh={() => { summary.reload(); results.reload(); }} refreshing={results.loading} />
      <DataState loading={summary.loading} error={summary.error} onRetry={summary.reload} hasData={Boolean(summary.data)}>
        {summary.data && (
          <div className="row g-3 mb-3">
            <div className="col-6 col-lg-3"><KpiTile label="Eligible records in scope" value={summary.data.eligibleRecords} /></div>
            <div className="col-6 col-lg-3"><KpiTile label="Active credentials" value={summary.data.credentialsByStatus.ACTIVE || 0} status="success" /></div>
            <div className="col-6 col-lg-3"><KpiTile label="Revoked credentials" value={summary.data.credentialsByStatus.REVOKED || 0} /></div>
            <div className="col-6 col-lg-3 d-flex align-items-center"><SyntheticTag /></div>
          </div>
        )}
      </DataState>
      <section className="card-gov">
        <h2>Search eligible students</h2>
        <p className="small text-muted">Search is limited to your affiliated institutions. Results are masked; open a record to see only the fields needed to issue a credential.</p>
        <form className="row g-2 align-items-end mb-3" onSubmit={(e) => { e.preventDefault(); setQuery({ search: text.trim(), page: 1 }); }}>
          <div className="col-md-6"><label className="form-label" htmlFor="iss-search">Exact student code or part of the name</label><input id="iss-search" className="form-control" value={text} onChange={(e) => setText(e.target.value)} /></div>
          <div className="col-md-6 d-flex gap-2"><Button type="submit" icon="search">Search eligible student</Button><Button variant="link" onClick={() => { setText(''); setQuery({ search: '', page: 1 }); }}>Clear</Button></div>
        </form>
        <DataState loading={results.loading} error={results.error} onRetry={results.reload} hasData={Boolean(results.data)} empty={results.data?.items.length === 0} emptyTitle="No eligible records match">
          {results.data && (
            <>
              <DataTable caption="Eligible records" rowKey={(r) => r.enrolmentRef} rows={results.data.items} columns={[
                { key: 'student', header: 'Student (masked)', render: (r) => <>{r.studentInitials}<div className="small mono">{r.studentCodeMasked}</div></> },
                { key: 'institutionCode', header: 'Institution' }, { key: 'courseCode', header: 'Course' }, { key: 'academicYear', header: 'Year' },
                { key: 'state', header: 'Enrolment', render: (r) => <StatusBadge status={r.state} /> },
                { key: 'credentials', header: 'Credentials', render: (r) => (r.credentials.length ? r.credentials.map((c) => <div key={`${c.credentialType}-${c.status}`} className="small">{c.credentialType.replaceAll('_', ' ').toLowerCase()}: <StatusBadge status={c.status} /></div>) : 'None') },
                { key: 'open', header: 'Details', render: (r) => <Link className="btn btn-sm btn-outline-primary" to={`/issuer/students/${r.enrolmentRef}`}>View permitted details</Link> },
              ]} />
              <Pagination page={results.data.page} totalPages={results.data.totalPages} total={results.data.total} onPage={(p) => setQuery((q) => ({ ...q, page: p }))} />
            </>
          )}
        </DataState>
      </section>
    </>
  );
}

export function IssuerStudentPage() {
  const { enrolmentRef } = useParams();
  useDocumentTitle('Issue credential');
  const record = useApi(() => api(`/issuer/enrolments/${enrolmentRef}`), [enrolmentRef]);
  const [issuing, setIssuing] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const action = useAction();
  const data = record.data;

  async function issue() {
    const result = await action.run(() => api('/credentials', { method: 'POST', body: { enrolmentRef, credentialType: issuing.code } }), {
      success: (r) => (r.idempotentReplay ? 'An active credential of this type already existed; no duplicate was created.' : 'Prototype credential generated.'), onError: () => {},
    });
    if (result) { setIssuing(null); record.reload(); }
  }
  async function revoke(reason) {
    const done = await action.run(() => api(`/credentials/${revoking}/revoke`, { method: 'POST', body: { reason } }), { success: 'Credential revoked. The public status page now shows REVOKED.', onError: () => {} });
    if (done) { setRevoking(null); record.reload(); }
  }

  return (
    <>
      <PageHeader title="Permitted record details" breadcrumbs={[{ label: 'Certificate workspace', to: '/issuer' }, { label: enrolmentRef }]} onRefresh={record.reload} refreshing={record.loading} />
      <DataState loading={record.loading} error={record.error} onRetry={record.reload} hasData={Boolean(data)}>
        {data && (
          <>
            <section className="card-gov">
              <h2>Minimum fields for issuance</h2>
              <KeyValue items={[
                ['Student', `${data.student.displayName} (${data.student.studentCode})`], ['Institution', `${data.institution.name} (${data.institution.code})`],
                ['Programme', `${data.programName} (${data.courseCode})`], ['Academic year', data.academicYear], ['Enrolment state', <StatusBadge key="s" status={data.state} />],
              ]} />
              <div className="d-flex flex-wrap gap-2 mt-3">
                {data.eligibleTypes.length === 0 && <Alert kind="info">No credential type is available for an enrolment in state {data.state}.</Alert>}
                {data.eligibleTypes.map((type) => {
                  const active = data.credentials.some((c) => c.credentialType === type.code && c.status === 'ACTIVE');
                  return (
                    <Button key={type.code} icon="award" onClick={() => setIssuing(type)} disabled={active} disabledReason="An active credential of this type already exists. Revoke it first to issue a new one.">
                      Generate {type.label}
                    </Button>
                  );
                })}
              </div>
            </section>
            <section className="card-gov">
              <h2>Credentials for this enrolment</h2>
              {data.credentials.length === 0 ? <p className="text-muted mb-0">None issued yet.</p> : data.credentials.map((credential) => (
                <div key={credential.credentialRef} className="border-bottom pb-3 mb-3">
                  <CredentialPanel credential={{ ...credential, snapshot: { ...credential.snapshot } }} actions={credential.status === 'ACTIVE' && <Button size="sm" variant="outline-danger" icon="slash-circle" onClick={() => setRevoking(credential.credentialRef)}>Revoke</Button>} />
                </div>
              ))}
            </section>
          </>
        )}
      </DataState>
      {issuing && <ConfirmDialog title={`Generate ${issuing.label}`} confirmLabel="Generate credential" onConfirm={issue} onClose={() => { setIssuing(null); action.setError(null); }} busy={action.busy} error={action.error}
        message="Creates a prototype credential reference and QR. The DigiLocker step is a MOCK that sends nothing. Repeating this does not create duplicates." />}
      {revoking && <ReasonDialog title="Revoke credential" variant="danger" confirmLabel="Revoke credential" onSubmit={revoke} onClose={() => { setRevoking(null); action.setError(null); }} busy={action.busy} error={action.error}
        description="The public status endpoint will report REVOKED from now on. This cannot be undone." />}
    </>
  );
}

export function IssuerCredentialsPage() {
  useDocumentTitle('Issued credentials');
  const [filters, setFilters] = useState({ status: '', page: 1 });
  const list = useApi(() => api(`/credentials${toQuery(filters)}`), [filters]);
  const exporter = useAction();
  return (
    <>
      <PageHeader title="Issued credentials" subtitle="Credentials issued by your organisation (student names shown as initials)." onRefresh={list.reload} refreshing={list.loading}
        actions={<Button variant="outline-primary" icon="download" loading={exporter.busy} onClick={() => exporter.run(() => downloadFile('/credentials/export.csv', 'credentials.csv'), { success: 'Export downloaded (masked).' })}>Export list</Button>} />
      <div className="col-sm-4 col-md-3 mb-3">
        <label className="form-label" htmlFor="ic-status">Status</label>
        <select id="ic-status" className="form-select" value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: 1 })}><option value="">All</option><option value="ACTIVE">Active</option><option value="REVOKED">Revoked</option></select>
      </div>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No credentials issued yet">
        {list.data && (
          <>
            <DataTable caption="Issued credentials" rowKey={(c) => c.credentialRef} rows={list.data.items} columns={[
              { key: 'ref', header: 'Reference', render: (c) => <span className="mono">…{c.credentialRef.slice(-12)}</span> },
              { key: 'type', header: 'Type', render: (c) => c.credentialTypeLabel },
              { key: 'holder', header: 'Holder', render: (c) => c.snapshot.displayName },
              { key: 'programme', header: 'Programme', render: (c) => `${c.snapshot.courseCode} (${c.snapshot.academicYear})` },
              { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
              { key: 'issuedAt', header: 'Issued', render: (c) => formatDate(c.issuedAt) },
              { key: 'open', header: 'Details', render: (c) => <Link className="btn btn-sm btn-outline-primary" to={`/issuer/students/${c.enrolmentRef}`}>View / revoke</Link> },
            ]} />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
          </>
        )}
      </DataState>
    </>
  );
}
