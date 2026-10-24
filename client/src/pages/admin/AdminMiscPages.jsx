import { useEffect, useState } from 'react';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { ReasonDialog } from '../../components/forms';
import { Alert, Button, DataState, DataTable, PageHeader, StatusBadge, formatDate } from '../../components/ui';

export function OrganisationsPage() {
  useDocumentTitle('Organisations');
  const [filters, setFilters] = useState({ type: '', status: '' });
  const list = useApi(() => api(`/admin/organisations${toQuery(filters)}`), [filters]);
  const [deciding, setDeciding] = useState(null);
  const action = useAction();

  async function decide(reason) {
    const done = await action.run(() => api(`/admin/organisations/${deciding.org.id}/${deciding.approve ? 'approve' : 'reject'}`, { method: 'POST', body: { reason } }), { success: deciding.approve ? 'Organisation approved.' : 'Organisation rejected.', onError: () => {} });
    if (done) { setDeciding(null); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Organisations" subtitle="Issuers and verifiers. Approval here is a prototype workflow - no real KYC or registration check is performed." onRefresh={list.reload} refreshing={list.loading} />
      <div className="row g-2 mb-3">
        <div className="col-6 col-md-3"><label className="form-label" htmlFor="o-type">Type</label>
          <select id="o-type" className="form-select" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}><option value="">All</option><option value="ISSUER">Issuer</option><option value="VERIFIER">Verifier</option></select></div>
        <div className="col-6 col-md-3"><label className="form-label" htmlFor="o-status">Status</label>
          <select id="o-status" className="form-select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}><option value="">All</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></div>
      </div>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No organisations match">
        {list.data && (
          <DataTable caption="Organisations" rowKey={(o) => o.id} rows={list.data.items} columns={[
            { key: 'name', header: 'Organisation', render: (o) => <>{o.name}<div className="small text-muted">{o.code}{o.isDemo ? ' - synthetic' : ''}</div></> },
            { key: 'type', header: 'Type', render: (o) => <>{o.type}{o.verifierCategory && <div className="small text-muted">{o.verifierCategory.replaceAll('_', ' ').toLowerCase()}</div>}</> },
            { key: 'scope', header: 'Scope', render: (o) => (o.type === 'ISSUER' ? `${o.affiliatedInstitutions} affiliated institution(s)` : o.description || '-') },
            { key: 'status', header: 'Status', render: (o) => <><StatusBadge status={o.status} />{o.decision && <div className="small text-muted">{o.decision.reason}</div>}</> },
            { key: 'createdAt', header: 'Submitted', render: (o) => formatDate(o.createdAt) },
            { key: 'actions', header: 'Decision', render: (o) => (o.status === 'PENDING' ? (
              <div className="d-flex gap-1"><Button size="sm" variant="success" onClick={() => setDeciding({ org: o, approve: true })}>Approve</Button><Button size="sm" variant="outline-danger" onClick={() => setDeciding({ org: o, approve: false })}>Reject</Button></div>
            ) : '-') },
          ]} />
        )}
      </DataState>
      {deciding && (
        <ReasonDialog title={`${deciding.approve ? 'Approve' : 'Reject'} ${deciding.org.name}`} minLength={5} variant={deciding.approve ? 'success' : 'danger'} confirmLabel={deciding.approve ? 'Approve' : 'Reject'}
          description="Prototype decision only; no real verification of the organisation is performed." onSubmit={decide} onClose={() => { setDeciding(null); action.setError(null); }} busy={action.busy} error={action.error} />
      )}
    </>
  );
}

export function SettingsPage() {
  useDocumentTitle('System settings');
  const settings = useApi(() => api('/admin/settings'), []);
  const [values, setValues] = useState({});
  const [confirming, setConfirming] = useState(false);
  const action = useAction();

  useEffect(() => {
    if (settings.data) setValues(Object.fromEntries(settings.data.items.map((item) => [item.key, item.value])));
  }, [settings.data]);
  const changes = settings.data ? Object.fromEntries(settings.data.items.filter((item) => values[item.key] !== item.value).map((item) => [item.key, values[item.key]])) : {};

  async function save(reason) {
    const done = await action.run(() => api('/admin/settings', { method: 'PUT', body: { changes, reason } }), { success: 'Settings saved and audited.', onError: () => {} });
    if (done) { setConfirming(false); settings.reload(); }
  }

  return (
    <>
      <PageHeader title="System settings" subtitle="Only these documented demo settings exist. Secrets are never shown or editable here." onRefresh={settings.reload} refreshing={settings.loading} />
      <DataState loading={settings.loading} error={settings.error} onRetry={settings.reload} hasData={Boolean(settings.data)}>
        {settings.data && (
          <div className="card-gov">
            {settings.data.items.map((item) => (
              <div key={item.key} className="mb-4">
                <label className="form-label" htmlFor={`s-${item.key}`}>{item.label}</label>
                {item.type === 'enum' ? (
                  <select id={`s-${item.key}`} className="form-select" value={values[item.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [item.key]: e.target.value }))}>
                    {item.allowed.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input id={`s-${item.key}`} type="number" className="form-control" min={item.min} max={item.max} value={values[item.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [item.key]: Number(e.target.value) }))} />
                )}
                <div className="form-text">{item.description}</div>
              </div>
            ))}
            <Button icon="save" onClick={() => setConfirming(true)} disabled={Object.keys(changes).length === 0} disabledReason="Change a setting first.">Save settings</Button>
          </div>
        )}
      </DataState>
      {confirming && (
        <ReasonDialog title="Save settings" confirmLabel="Save" onSubmit={save} onClose={() => { setConfirming(false); action.setError(null); }} busy={action.busy} error={action.error}
          description={`Changing: ${Object.keys(changes).join(', ')}. Every security-relevant change is recorded in the audit log.`} />
      )}
    </>
  );
}

export function LedgerCheckPage() {
  useDocumentTitle('Ledger check');
  const check = useApi(() => api('/admin/ledger-reconciliation'), []);
  return (
    <>
      <PageHeader title="Seat ledger reconciliation" subtitle="Compares every seat counter with the number of enrolments that currently hold a seat." onRefresh={check.reload} refreshing={check.loading} />
      <DataState loading={check.loading} error={check.error} onRetry={check.reload} hasData={Boolean(check.data)}>
        {check.data && (
          <>
            {check.data.consistent
              ? <Alert kind="success" title="Consistent">All {check.data.checkedLedgers} ledger rows match the enrolments holding seats (checked {formatDate(check.data.checkedAt, true)}).</Alert>
              : <Alert kind="error" title={`${check.data.mismatches.length} mismatch(es)`}>Investigate before demonstrating certification.</Alert>}
            {check.data.mismatches.length > 0 && (
              <DataTable rowKey={(m) => `${m.courseCode}-${m.bucketCode}-${m.academicYear}`} rows={check.data.mismatches} columns={[
                { key: 'courseCode', header: 'Course' }, { key: 'bucketCode', header: 'Bucket' }, { key: 'academicYear', header: 'Year' },
                { key: 'ledgerFilled', header: 'Ledger filled', numeric: true }, { key: 'enrolmentsHoldingSeats', header: 'Enrolments holding seats', numeric: true }, { key: 'capacity', header: 'Capacity', numeric: true },
              ]} />
            )}
          </>
        )}
      </DataState>
    </>
  );
}
