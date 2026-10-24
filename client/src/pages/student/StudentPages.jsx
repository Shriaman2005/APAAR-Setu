import { useState } from 'react';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import Modal from '../../components/Modal';
import { CheckboxField, ConfirmDialog, ReasonDialog, SelectField, TextAreaField, TextField } from '../../components/forms';
import { Alert, Button, DataState, DataTable, ErrorAlert, KeyValue, PageHeader, Pagination, StatusBadge, formatDate } from '../../components/ui';
import { CredentialPanel } from '../shared/CredentialPanel';

function CorrectionForm({ enrolments, onClose, onDone }) {
  const [form, setForm] = useState({ enrolmentRef: enrolments[0]?.enrolmentRef || '', correctionType: 'NAME_CORRECTION', explanation: '', evidenceNote: '', proposedValue: '' });
  const [touched, setTouched] = useState(false);
  const action = useAction();
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const tooShort = form.explanation.trim().length < 20;
  const nameMissing = form.correctionType === 'NAME_CORRECTION' && !form.proposedValue.trim();

  async function submit() {
    setTouched(true);
    if (tooShort || nameMissing) return;
    const body = { enrolmentRef: form.enrolmentRef, correctionType: form.correctionType, explanation: form.explanation.trim(), evidenceNote: form.evidenceNote.trim() || undefined, proposedValue: form.correctionType === 'NAME_CORRECTION' ? form.proposedValue.trim() : undefined };
    const result = await action.run(() => api('/students/me/correction-requests', { method: 'POST', body }), { success: 'Correction request sent to your institution. Your record stays unchanged until it is reviewed.', onError: () => {} });
    if (result) onDone();
  }

  return (
    <Modal title="Request a correction" size="lg" onClose={onClose} busy={action.busy} footer={(
      <><Button icon="send" onClick={submit} loading={action.busy}>Submit request</Button><Button variant="outline-primary" onClick={onClose} disabled={action.busy}>Cancel</Button></>
    )}>
      <SelectField label="Enrolment" value={form.enrolmentRef} onChange={(v) => set('enrolmentRef', v)} required options={enrolments.map((e) => ({ value: e.enrolmentRef, label: `${e.institutionName} - ${e.courseCode} (${e.academicYear})` }))} />
      <SelectField label="What needs correcting?" value={form.correctionType} onChange={(v) => set('correctionType', v)} required options={[
        { value: 'NAME_CORRECTION', label: 'My name is spelled incorrectly' }, { value: 'ENROLMENT_DETAIL', label: 'Another enrolment detail is wrong' },
      ]} />
      {form.correctionType === 'NAME_CORRECTION' && <TextField label="Correct name" value={form.proposedValue} onChange={(v) => set('proposedValue', v)} required error={touched && nameMissing ? 'Enter the correct name.' : null} />}
      <TextAreaField label="Explanation" value={form.explanation} onChange={(v) => set('explanation', v)} required rows={4} maxLength={1000} hint="At least 20 characters." error={touched && tooShort ? 'Explain the problem in at least 20 characters.' : null} />
      <TextField label="Evidence reference (optional)" value={form.evidenceNote} onChange={(v) => set('evidenceNote', v)} maxLength={300} hint="For example the number of your admission letter. File uploads are not part of this prototype." />
      <ErrorAlert error={action.error} />
    </Modal>
  );
}

export function StudentRecordPage() {
  useDocumentTitle('My record');
  const record = useApi(() => api('/students/me'), []);
  const [correcting, setCorrecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const data = record.data;
  return (
    <>
      <PageHeader title="My record" subtitle="Your official enrolment record. You cannot edit it directly; request a correction instead." onRefresh={record.reload} refreshing={record.loading}
        actions={data?.enrolments.length > 0 && <Button variant="outline-primary" icon="pencil-square" onClick={() => setCorrecting(true)}>Request correction</Button>} />
      <DataState loading={record.loading} error={record.error} onRetry={record.reload} hasData={Boolean(data)}>
        {data && (
          <>
            <Alert kind="info" className="mb-3">{data.notice}</Alert>
            <div className="row g-3">
              <div className="col-lg-5">
                <section className="card-gov">
                  <h2>Profile</h2>
                  <KeyValue items={[
                    ['Name', data.student.displayName], ['Student code', data.student.studentCode], ['Demo identifier', <span key="x" className="mono">{data.student.externalIdMasked}</span>],
                    ['Identity link (mock)', <StatusBadge key="s" status={data.student.externalLinkStatus} />],
                  ]} />
                  <h3 className="mt-3">Verification reference</h3>
                  <p className="small">Share this reference with an organisation that needs to verify you. It reveals nothing until you approve their request.</p>
                  <div className="d-flex gap-2 align-items-center flex-wrap">
                    <code className="mono">{data.student.studentRef}</code>
                    <Button size="sm" variant="outline-primary" icon="clipboard" onClick={async () => { try { await navigator.clipboard.writeText(data.student.studentRef); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy'}</Button>
                  </div>
                  <p className="small mt-3 mb-0">{data.pendingConsents} consent request(s) waiting - {data.credentials} credential(s).</p>
                </section>
              </div>
              <div className="col-lg-7">
                <section className="card-gov">
                  <h2>Enrolments</h2>
                  {data.enrolments.length === 0 ? <p className="text-muted mb-0">No official enrolment has been certified for you yet.</p> : data.enrolments.map((enrolment) => (
                    <div key={enrolment.enrolmentRef} className="border-bottom pb-3 mb-3">
                      <KeyValue items={[
                        ['Institution', enrolment.institutionName], ['Programme', `${enrolment.programName} (${enrolment.courseCode})`], ['Academic year / year', `${enrolment.academicYear} / ${enrolment.yearOfStudy}`],
                        ['Status', <StatusBadge key="s" status={enrolment.state} />], ['Admitted on', formatDate(enrolment.admittedOn)],
                      ]} />
                      <ol className="timeline mt-2">{enrolment.history.map((h) => <li key={`${h.toState}-${h.at}`} className="small">{h.toState} - {h.reason} ({formatDate(h.at, true)})</li>)}</ol>
                    </div>
                  ))}
                </section>
              </div>
            </div>
          </>
        )}
      </DataState>
      {correcting && <CorrectionForm enrolments={data.enrolments} onClose={() => setCorrecting(false)} onDone={() => setCorrecting(false)} />}
    </>
  );
}

function ApproveDialog({ consent, fieldLabels, onClose, onDone }) {
  const [fields, setFields] = useState(consent.requestedFields);
  const action = useAction();
  async function approve() {
    const done = await action.run(() => api(`/consents/${consent.consentId}/approve`, { method: 'POST', body: { approvedFields: fields } }), { success: 'Consent approved for the selected fields.', onError: () => {} });
    if (done) onDone();
  }
  return (
    <ConfirmDialog title={`Approve request from ${consent.requester.name}`} variant="success" confirmLabel="Approve selected fields" onConfirm={approve} onClose={onClose} busy={action.busy} error={action.error} confirmDisabled={fields.length === 0}>
      <p>Purpose: <strong>{consent.purposeLabel}</strong>. Valid until {formatDate(consent.expiresAt, true)}. You can revoke it at any time.</p>
      <fieldset>
        <legend className="form-label fs-6">Share these fields (untick any you do not want to share)</legend>
        {consent.requestedFields.map((field) => <CheckboxField key={field} id={`ap-${field}`} label={fieldLabels[field] || field} checked={fields.includes(field)} onChange={(checked) => setFields((f) => (checked ? [...f, field] : f.filter((x) => x !== field)))} />)}
      </fieldset>
      {fields.length === 0 && <p className="field-error">Select at least one field, or deny the request instead.</p>}
      <p className="small text-muted mb-0">{consent.modeNote}</p>
    </ConfirmDialog>
  );
}

export function ConsentInboxPage() {
  useDocumentTitle('Consent inbox');
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const list = useApi(() => api(`/consents${toQuery({ status, page })}`), [status, page]);
  const [approving, setApproving] = useState(null);
  const [denying, setDenying] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const action = useAction();

  async function decide(kind, consent, note) {
    const done = await action.run(() => api(`/consents/${consent.consentId}/${kind}`, { method: 'POST', body: note ? { note } : {} }), { success: kind === 'deny' ? 'Request denied. No data was shared.' : 'Consent revoked. Future access is blocked.', onError: () => {} });
    if (done) { setDenying(null); setRevoking(null); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Consent inbox" subtitle="Decide who may verify your record, for what purpose and which fields." onRefresh={list.reload} refreshing={list.loading} />
      <ul className="nav nav-tabs mb-3">
        {[['PENDING', 'Waiting for you'], ['APPROVED', 'Active consents'], ['', 'All history']].map(([key, label]) => (
          <li className="nav-item" key={label}><button type="button" className={`nav-link ${status === key ? 'active fw-semibold' : ''}`} aria-pressed={status === key} onClick={() => { setStatus(key); setPage(1); }}>{label}</button></li>
        ))}
      </ul>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="Nothing here">
        {list.data && (
          <>
            {list.data.items.map((consent) => (
              <section key={consent.consentId} className="card-gov">
                <div className="d-flex flex-wrap justify-content-between gap-2">
                  <h2 className="h3 mb-1">{consent.requester.name}</h2>
                  <StatusBadge status={consent.status} />
                </div>
                <KeyValue items={[
                  ['Purpose', consent.purposeLabel], ['Requested fields', consent.requestedFields.map((f) => list.data.fieldLabels[f] || f).join(', ')],
                  consent.approvedFields.length > 0 && ['Approved fields', consent.approvedFields.map((f) => list.data.fieldLabels[f] || f).join(', ')],
                  ['Requested on', formatDate(consent.createdAt, true)], ['Expires', formatDate(consent.expiresAt, true)],
                  consent.receiptHash && ['Receipt (plain hash, not a signature)', <span key="h" className="mono">{consent.receiptHash.slice(0, 16)}…</span>],
                ]} />
                <div className="d-flex flex-wrap gap-2 mt-3">
                  {consent.status === 'PENDING' && <><Button variant="success" icon="check-lg" onClick={() => setApproving(consent)}>Approve</Button><Button variant="danger" icon="x-lg" onClick={() => setDenying(consent)}>Deny</Button></>}
                  {consent.status === 'APPROVED' && <Button variant="outline-danger" icon="slash-circle" onClick={() => setRevoking(consent)}>Revoke consent</Button>}
                </div>
              </section>
            ))}
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />
          </>
        )}
      </DataState>
      {approving && <ApproveDialog consent={approving} fieldLabels={list.data.fieldLabels} onClose={() => setApproving(null)} onDone={() => { setApproving(null); list.reload(); }} />}
      {denying && <ConfirmDialog title={`Deny request from ${denying.requester.name}`} variant="danger" confirmLabel="Deny request" onConfirm={() => decide('deny', denying)} onClose={() => { setDenying(null); action.setError(null); }} busy={action.busy} error={action.error} message="The verifier will receive no data from your record." />}
      {revoking && <ReasonDialog title="Revoke consent" variant="danger" confirmLabel="Revoke" minLength={3} label="Note (optional reason, at least 3 characters)" onSubmit={(note) => decide('revoke', revoking, note)} onClose={() => { setRevoking(null); action.setError(null); }} busy={action.busy} error={action.error} description="The verifier will no longer be able to view your data. Past views stay in your access history." />}
    </>
  );
}

export function AccessLogPage() {
  useDocumentTitle('Access history');
  const [page, setPage] = useState(1);
  const list = useApi(() => api(`/students/me/access-log${toQuery({ page })}`), [page]);
  return (
    <>
      <PageHeader title="Access history" subtitle="Every time a verifier viewed your data with your consent." onRefresh={list.reload} refreshing={list.loading} />
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No one has viewed your data yet">
        {list.data && (
          <>
            <DataTable caption="Access history" rowKey={(r) => r.accessRef} rows={list.data.items} columns={[
              { key: 'accessedAt', header: 'When', render: (r) => formatDate(r.accessedAt, true) },
              { key: 'verifierName', header: 'Verifier' },
              { key: 'purposeLabel', header: 'Purpose' },
              { key: 'fieldsDisclosed', header: 'Fields disclosed', render: (r) => r.fieldsDisclosed.map((f) => list.data.fieldLabels[f] || f).join(', ') },
              { key: 'accessRef', header: 'Reference', render: (r) => <span className="mono small">{r.accessRef}</span> },
            ]} />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />
          </>
        )}
      </DataState>
    </>
  );
}

export function StudentCredentialsPage() {
  useDocumentTitle('My credentials');
  const credentials = useApi(() => api('/students/me/credentials'), []);
  const record = useApi(() => api('/students/me'), []);
  const action = useAction();
  const eligible = (record.data?.enrolments || []).filter((e) => ['CONFIRMED', 'COMPLETED'].includes(e.state));
  return (
    <>
      <PageHeader title="My credentials" subtitle="Prototype credentials issued by your degree-awarding body." onRefresh={credentials.reload} refreshing={credentials.loading} />
      <DataState loading={credentials.loading} error={credentials.error} onRetry={credentials.reload} hasData={Boolean(credentials.data)}>
        {credentials.data && (credentials.data.items.length === 0 ? (
          <section className="card-gov">
            <p>No credential has been issued to you yet. Credentials are issued by your degree-awarding body.</p>
            {eligible.length > 0 ? eligible.map((e) => (
              <Button key={e.enrolmentRef} variant="outline-primary" icon="send" loading={action.busy} onClick={() => action.run(() => api('/students/me/credential-requests', { method: 'POST', body: { enrolmentRef: e.enrolmentRef } }), { success: (r) => `Request sent to ${r.issuers.join(', ')}.` })}>
                Request credential for {e.courseCode} ({e.academicYear})
              </Button>
            )) : <p className="small text-muted mb-0">A credential can be requested once you have a confirmed enrolment.</p>}
          </section>
        ) : credentials.data.items.map((credential) => (
          <section key={credential.credentialRef} className="card-gov"><CredentialPanel credential={credential} /></section>
        )))}
      </DataState>
    </>
  );
}

export function StudentCorrectionsPage() {
  useDocumentTitle('My correction requests');
  const list = useApi(() => api('/students/me/correction-requests'), []);
  return (
    <>
      <PageHeader title="My correction requests" subtitle="Requests you sent to your institution. Submit new ones from “My record”." onRefresh={list.reload} refreshing={list.loading} />
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No correction requests">
        {list.data && (
          <DataTable caption="Correction requests" rowKey={(r) => r.correctionRequestId} rows={list.data.items} columns={[
            { key: 'createdAt', header: 'Submitted', render: (r) => formatDate(r.createdAt, true) },
            { key: 'correctionType', header: 'Type', render: (r) => <>{r.correctionType.replace('_', ' ').toLowerCase()}{r.proposedValue && <div className="small">“{r.proposedValue}”</div>}</> },
            { key: 'explanation', header: 'Explanation' },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'decision', header: 'Institution response', render: (r) => (r.decision ? <>{r.decision.response}{r.decision.appliedChange && <div className="small text-muted">{r.decision.appliedChange}</div>}</> : 'Awaiting review') },
          ]} />
        )}
      </DataState>
    </>
  );
}
