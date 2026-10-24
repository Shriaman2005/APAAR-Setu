import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import { CheckboxField, ConfirmDialog, SelectField, TextAreaField, TextField } from '../../components/forms';
import { Alert, Button, DataState, DataTable, ErrorAlert, KeyValue, KpiTile, PageHeader, Pagination, StatusBadge, formatDate } from '../../components/ui';

export function VerifierDashboard() {
  useDocumentTitle('Verification requests');
  const summary = useApi(() => api('/dashboard/verifier'), []);
  const [filters, setFilters] = useState({ status: '', page: 1 });
  const list = useApi(() => api(`/verification-requests${toQuery(filters)}`), [filters]);
  const org = summary.data?.organisation;
  return (
    <>
      <PageHeader title="Verification requests" subtitle={org ? `${org.name} (${org.status.toLowerCase()})` : null} onRefresh={() => { summary.reload(); list.reload(); }} refreshing={list.loading}
        actions={<Link className={`btn btn-primary ${org?.status === 'APPROVED' ? '' : 'disabled'}`} aria-disabled={org?.status !== 'APPROVED'} to="/verifier/requests/new"><i className="bi bi-plus-lg" aria-hidden="true" />New request</Link>} />
      {summary.data && !org && <Alert kind="warning" className="mb-3">Your account is not linked to an organisation yet. <Link to="/verifier/onboarding">Submit your organisation</Link> first.</Alert>}
      {org && org.status !== 'APPROVED' && <Alert kind="warning" className="mb-3">Your organisation is {org.status.toLowerCase()}. Requests can be created after an administrator approves it (prototype workflow, no real KYC).</Alert>}
      {summary.data && (
        <div className="row g-3 mb-3">
          {['PENDING', 'APPROVED', 'DENIED', 'REVOKED', 'EXPIRED'].map((s) => <div className="col-6 col-md" key={s}><KpiTile label={s.toLowerCase()} value={summary.data.requestsByStatus[s] || 0} /></div>)}
        </div>
      )}
      <div className="col-sm-4 col-md-3 mb-3">
        <label className="form-label" htmlFor="vr-status">Status</label>
        <select id="vr-status" className="form-select" value={filters.status} onChange={(e) => setFilters({ status: e.target.value, page: 1 })}>
          <option value="">All</option>{['PENDING', 'APPROVED', 'DENIED', 'REVOKED', 'EXPIRED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </select>
      </div>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No requests yet">
        {list.data && (
          <>
            <DataTable caption="Verification requests" rowKey={(r) => r.requestId} rows={list.data.items} columns={[
              { key: 'requestId', header: 'Request', render: (r) => <Link to={`/verifier/requests/${r.requestId}`}>{r.requestId}</Link> },
              { key: 'student', header: 'Student reference', render: (r) => <span className="mono">{r.studentRefMasked}</span> },
              { key: 'purpose', header: 'Purpose', render: (r) => r.purposeLabel },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'expiresAt', header: 'Expires', render: (r) => formatDate(r.expiresAt, true) },
            ]} />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
          </>
        )}
      </DataState>
    </>
  );
}

export function VerifierOnboardingPage() {
  useDocumentTitle('Verifier organisation');
  const { refreshUser } = useAuth();
  const org = useApi(() => api('/verifier/organisation'), []);
  const [form, setForm] = useState({ name: '', verifierCategory: 'EMPLOYER', description: '' });
  const action = useAction();
  async function submit(event) {
    event.preventDefault();
    const done = await action.run(() => api('/verifier/organisation', { method: 'POST', body: form }), { success: 'Organisation submitted for approval.', onError: () => {} });
    if (done) { org.reload(); refreshUser(); }
  }
  return (
    <>
      <PageHeader title="Verifier organisation" subtitle="Prototype onboarding: an administrator approves your organisation. No real KYC or registry check happens." onRefresh={org.reload} refreshing={org.loading} />
      <DataState loading={org.loading} error={org.error} onRetry={org.reload} hasData={Boolean(org.data)}>
        {org.data?.organisation ? (
          <section className="card-gov">
            <KeyValue items={[['Organisation', org.data.organisation.name], ['Code', org.data.organisation.code], ['Category', org.data.organisation.verifierCategory], ['Status', <StatusBadge key="s" status={org.data.organisation.status} />], org.data.organisation.decision && ['Decision note', org.data.organisation.decision.reason]]} />
          </section>
        ) : (
          <form className="card-gov" onSubmit={submit} noValidate>
            <TextField label="Organisation name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} required />
            <SelectField label="Category" value={form.verifierCategory} onChange={(v) => setForm((f) => ({ ...f, verifierCategory: v }))} required options={[
              { value: 'EMPLOYER', label: 'Employer' }, { value: 'EDUCATION_INSTITUTION', label: 'Education institution' }, { value: 'SCHOLARSHIP_PROVIDER', label: 'Scholarship provider' }, { value: 'FINANCIAL_INSTITUTION', label: 'Financial institution' },
            ]} />
            <TextAreaField label="Description (optional)" value={form.description} onChange={(v) => setForm((f) => ({ ...f, description: v }))} maxLength={500} />
            <ErrorAlert error={action.error} className="mb-3" />
            <Button type="submit" icon="send" loading={action.busy}>Submit organisation</Button>
          </form>
        )}
      </DataState>
    </>
  );
}

export function NewRequestPage() {
  useDocumentTitle('New verification request');
  const navigate = useNavigate();
  const options = useApi(() => api('/verification-requests/options'), []);
  const [studentRef, setStudentRef] = useState('');
  const [purpose, setPurpose] = useState('');
  const [fields, setFields] = useState([]);
  const [expiryDays, setExpiryDays] = useState('7');
  const [touched, setTouched] = useState(false);
  const action = useAction();
  const purposeInfo = options.data?.purposes.find((p) => p.code === purpose);

  async function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (!studentRef.trim() || !purpose || fields.length === 0) return;
    const result = await action.run(() => api('/verification-requests', { method: 'POST', body: { studentRef: studentRef.trim(), purpose, requestedFields: fields, expiryDays: Number(expiryDays) } }), { success: 'Request sent. The student must approve it before any data is shared.', onError: () => {} });
    if (result) navigate(`/verifier/requests/${result.requestId}`);
  }

  return (
    <>
      <PageHeader title="New verification request" breadcrumbs={[{ label: 'My requests', to: '/verifier' }, { label: 'New request' }]} />
      <DataState loading={options.loading} error={options.error} onRetry={options.reload} hasData={Boolean(options.data)}>
        {options.data && (
          <form className="card-gov" onSubmit={submit} noValidate>
            <Alert kind="info" className="mb-3">{options.data.policyNote}</Alert>
            <TextField label="Student reference" value={studentRef} onChange={setStudentRef} required hint="The student shares this reference (SR-...) from their portal. Knowing it reveals nothing until they consent." error={touched && !studentRef.trim() ? 'Enter the student reference.' : null} />
            <SelectField label="Purpose" value={purpose} onChange={(v) => { setPurpose(v); setFields([]); }} required placeholder="Choose a documented purpose" error={touched && !purpose ? 'Choose a purpose.' : null}
              options={options.data.purposes.map((p) => ({ value: p.code, label: p.label }))} />
            {purposeInfo && (
              <fieldset className="mb-3">
                <legend className="form-label fs-6">Fields to request<span className="required-mark">*</span></legend>
                <p className="small text-muted">Only fields allowed for this purpose are offered; the server rejects anything else.</p>
                {purposeInfo.allowedFields.map((field) => (
                  <CheckboxField key={field} id={`field-${field}`} label={options.data.fieldLabels[field]} checked={fields.includes(field)} onChange={(checked) => setFields((f) => (checked ? [...f, field] : f.filter((x) => x !== field)))} />
                ))}
                {touched && fields.length === 0 && <div className="field-error">Select at least one field.</div>}
              </fieldset>
            )}
            <SelectField label="Request and consent expiry" value={expiryDays} onChange={setExpiryDays} required options={options.data.expiryOptionsDays.map((d) => ({ value: String(d), label: `${d} day${d > 1 ? 's' : ''}` }))} />
            <ErrorAlert error={action.error} className="mb-3" />
            <div className="d-flex gap-2"><Button type="submit" icon="send" loading={action.busy} loadingText="Sending...">Submit request</Button><Link className="btn btn-outline-primary" to="/verifier">Cancel</Link></div>
          </form>
        )}
      </DataState>
    </>
  );
}

export function RequestDetailPage() {
  const { requestId } = useParams();
  useDocumentTitle(`Request ${requestId}`);
  const request = useApi(() => api(`/verification-requests/${requestId}`), [requestId]);
  const [result, setResult] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const action = useAction();
  const data = request.data;

  async function viewResult() {
    setResult(null);
    const outcome = await action.run(() => api(`/verification-requests/${requestId}/result`), { onError: () => {} });
    if (outcome) setResult(outcome);
    request.reload();
  }
  async function cancel() {
    const done = await action.run(() => api(`/verification-requests/${requestId}/cancel`, { method: 'POST' }), { success: 'Request cancelled.', onError: () => {} });
    if (done) { setCancelling(false); request.reload(); }
  }

  return (
    <>
      <PageHeader title={`Request ${requestId}`} breadcrumbs={[{ label: 'My requests', to: '/verifier' }, { label: requestId }]} onRefresh={request.reload} refreshing={request.loading} />
      <DataState loading={request.loading} error={request.error} onRetry={request.reload} hasData={Boolean(data)}>
        {data && (
          <div className="row g-3">
            <div className="col-lg-5">
              <section className="card-gov">
                <h2>Status</h2>
                <KeyValue items={[
                  ['Status', <StatusBadge key="s" status={data.status} />], ['Student reference', <span key="r" className="mono">{data.studentRefMasked}</span>], ['Purpose', data.purposeLabel],
                  ['Requested fields', data.requestedFields.join(', ')], ['Approved fields', data.approvedFields.length ? data.approvedFields.join(', ') : '-'],
                  ['Expires', formatDate(data.expiresAt, true)], ['Last viewed', formatDate(data.lastAccessedAt, true)],
                ]} />
                <div className="d-flex flex-wrap gap-2 mt-3">
                  <Button icon="eye" onClick={viewResult} loading={action.busy && !cancelling} disabled={!data.canViewResult} disabledReason="A result is only available while the student's consent is approved and unexpired.">View approved result</Button>
                  {data.canCancel && <Button variant="outline-danger" icon="x-circle" onClick={() => setCancelling(true)}>Cancel request</Button>}
                </div>
                {!cancelling && <ErrorAlert error={action.error} />}
              </section>
            </div>
            <div className="col-lg-7">
              <section className="card-gov" aria-live="polite">
                <h2>Approved result</h2>
                {!result ? <p className="text-muted mb-0">Select “View approved result”. Each view is recorded in the student&apos;s access history.</p> : (
                  <>
                    <KeyValue items={Object.entries(result.data).map(([field, value]) => [result.fieldLabels[field] || field, value ?? '-'])} />
                    <p className="small text-muted mt-2 mb-1">Retrieved {formatDate(result.retrievedAt, true)} (access reference {result.accessRef}). Consent valid until {formatDate(result.consentExpiresAt, true)}.</p>
                    <Alert kind="warning">{result.notice}</Alert>
                  </>
                )}
              </section>
            </div>
          </div>
        )}
      </DataState>
      {cancelling && <ConfirmDialog title="Cancel request" variant="danger" confirmLabel="Cancel request" onConfirm={cancel} onClose={() => { setCancelling(false); action.setError(null); }} busy={action.busy} error={action.error} message="The student will no longer be asked to decide. No data is shared." />}
    </>
  );
}
