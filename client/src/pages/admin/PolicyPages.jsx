import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth } from '../../features/auth/AuthContext';
import { ConfirmDialog, ReasonDialog, TextAreaField, TextField } from '../../components/forms';
import { Alert, Button, DataState, DataTable, ErrorAlert, KeyValue, PageHeader, StatusBadge, formatDate } from '../../components/ui';

function usePolicyBase() {
  const { user } = useAuth();
  const isAdmin = user.role === 'AICTE_SYSTEM_ADMIN';
  return { isAdmin, base: isAdmin ? '/admin/policies' : '/aicte/policies', user };
}

export function PolicyListPage() {
  const { isAdmin, base } = usePolicyBase();
  useDocumentTitle('Seat policies');
  const navigate = useNavigate();
  const list = useApi(() => api('/admin/seat-policies'), []);
  const [compare, setCompare] = useState([]);
  return (
    <>
      <PageHeader title="Seat policies" subtitle={isAdmin ? 'Versioned synthetic seat capacities. Publishing needs a different administrator (maker-checker).' : 'Read-only oversight view of seat-policy versions.'}
        onRefresh={list.reload} refreshing={list.loading}
        actions={(
          <>
            <Button variant="outline-primary" icon="layout-split" disabled={compare.length !== 2} disabledReason="Select exactly two versions to compare." onClick={() => navigate(`${base}/compare?from=${compare[0]}&to=${compare[1]}`)}>Compare versions</Button>
            {isAdmin && <Link className="btn btn-primary" to="/admin/policies/new"><i className="bi bi-plus-lg" aria-hidden="true" />Create draft</Link>}
          </>
        )} />
      <Alert kind="warning" className="mb-3">All capacities are SYNTHETIC_DEMO_CONFIG test data. They are not official AICTE quotas and must never become production defaults.</Alert>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No seat policies">
        {list.data && (
          <DataTable caption="Seat policies" rowKey={(p) => p.id} rows={list.data.items} columns={[
            { key: 'select', header: 'Compare', render: (p) => <input type="checkbox" className="form-check-input" aria-label={`Select ${p.version} for comparison`} checked={compare.includes(p.id)} onChange={(e) => setCompare((c) => (e.target.checked ? [...c, p.id].slice(-2) : c.filter((id) => id !== p.id)))} /> },
            { key: 'version', header: 'Version', render: (p) => <Link to={`${base}/${p.id}`}>{p.version}</Link> },
            { key: 'academicYear', header: 'Academic year' },
            { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
            { key: 'sourceReference', header: 'Source', render: (p) => <>{p.sourceType}<div className="small text-muted">{p.sourceReference}</div></> },
            { key: 'authoredByName', header: 'Author' },
            { key: 'approvedByName', header: 'Approved by', render: (p) => p.approvedByName ? `${p.approvedByName} (${formatDate(p.approvedAt)})` : '-' },
          ]} />
        )}
      </DataState>
    </>
  );
}

export function PolicyDetailPage() {
  const { id } = useParams();
  const { isAdmin, base, user } = usePolicyBase();
  useDocumentTitle('Seat policy');
  const policy = useApi(() => api(`/admin/seat-policies/${id}`), [id]);
  const [dialog, setDialog] = useState(null);
  const action = useAction();
  const p = policy.data;
  const isAuthor = p && p.authoredBy === user.id;

  async function run(path, success, body) {
    const result = await action.run(() => api(`/admin/seat-policies/${id}/${path}`, { method: 'POST', body }), { success, onError: () => {} });
    if (result) { setDialog(null); policy.reload(); }
    return result;
  }

  return (
    <>
      <PageHeader title={p ? `Seat policy ${p.version} (${p.academicYear})` : 'Seat policy'} breadcrumbs={[{ label: 'Seat policies', to: base }, { label: p?.version || id }]} onRefresh={policy.reload} refreshing={policy.loading} />
      <DataState loading={policy.loading} error={policy.error} onRetry={policy.reload} hasData={Boolean(p)}>
        {p && (
          <>
            {isAdmin && (
              <div className="card-gov mb-3">
                <h2 className="h3">Actions</h2>
                <div className="d-flex flex-wrap gap-2">
                  {p.status === 'DRAFT' && isAuthor && <Link className="btn btn-outline-primary" to={`/admin/policies/${id}/edit`}><i className="bi bi-pencil" aria-hidden="true" />Edit draft</Link>}
                  {['DRAFT', 'PENDING_APPROVAL'].includes(p.status) && <Button variant="outline-primary" icon="clipboard-check" loading={action.busy && !dialog} onClick={() => run('validate', 'Validation finished.')}>Validate rules</Button>}
                  {p.status === 'DRAFT' && (
                    <Button icon="send" disabled={!isAuthor || !p.lastValidation?.upToDate || p.lastValidation?.status !== 'PASSED'}
                      disabledReason={!isAuthor ? 'Only the author can submit this draft.' : 'Run "Validate rules" on the current draft and fix all errors first.'} onClick={() => setDialog('submit')}>Submit for approval</Button>
                  )}
                  {p.status === 'PENDING_APPROVAL' && (
                    <>
                      <Button variant="success" icon="broadcast" disabled={isAuthor} disabledReason="Separation of duties: a different administrator must approve." onClick={() => setDialog('publish')}>Approve and publish</Button>
                      <Button variant="outline-danger" icon="arrow-return-left" disabled={isAuthor} disabledReason="A different administrator must review this policy." onClick={() => setDialog('reject')}>Return to draft</Button>
                    </>
                  )}
                </div>
                <ErrorAlert error={!dialog ? action.error : null} />
              </div>
            )}
            {p.lastValidation && (
              <Alert kind={p.lastValidation.status === 'PASSED' ? 'success' : 'error'} className="mb-3" title={`Validation ${p.lastValidation.status} (${formatDate(p.lastValidation.checkedAt, true)})${p.lastValidation.upToDate ? '' : ' - out of date, the draft changed since'}`}>
                {p.lastValidation.errors.length > 0 && <ul className="mb-1">{p.lastValidation.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                {p.lastValidation.warnings.length > 0 && <><strong>Warnings</strong><ul className="mb-0">{p.lastValidation.warnings.map((w) => <li key={w}>{w}</li>)}</ul></>}
                {p.lastValidation.errors.length === 0 && p.lastValidation.warnings.length === 0 && 'No problems found.'}
              </Alert>
            )}
            {p.rejection && <Alert kind="warning" className="mb-3" title="Returned to draft by the approver">{p.rejection.reason}</Alert>}
            <section className="card-gov">
              <h2>Metadata</h2>
              <KeyValue items={[
                ['Status', <StatusBadge key="s" status={p.status} />], ['Source type', p.sourceType], ['Source reference', p.sourceReference], ['Notes', p.notes || '-'],
                ['Admission window', `${p.admissionWindow.opensOn} to ${p.admissionWindow.closesOn}`], ['Author', p.authoredByName], ['Submitted', formatDate(p.submittedAt, true)],
                ['Approved by', p.approvedByName ? `${p.approvedByName} on ${formatDate(p.approvedAt, true)}` : '-'], ['Effective from', formatDate(p.effectiveAt, true)], ['Superseded', formatDate(p.supersededAt, true)],
              ]} />
            </section>
            <section className="card-gov">
              <h2>Capacities</h2>
              <DataTable rowKey={(r) => r.key} columns={[
                { key: 'scope', header: 'Institution / course' }, { key: 'code', header: 'Bucket' }, { key: 'capacity', header: 'Capacity', numeric: true },
                { key: 'counts', header: 'Counts within intake', render: (r) => (r.countsWithinIntake ? 'Yes' : 'No (additional)') },
              ]} rows={p.scopes.flatMap((s) => s.buckets.map((b) => ({ key: `${s.institutionCode}-${s.courseCode}-${b.code}`, scope: `${s.institutionCode} / ${s.courseCode}`, ...b })))} />
            </section>
          </>
        )}
      </DataState>
      {dialog === 'submit' && <ConfirmDialog title="Submit for approval" confirmLabel="Submit" onConfirm={() => run('submit', 'Submitted. A different administrator must approve it.')} onClose={() => setDialog(null)} busy={action.busy} error={action.error} message="Other administrators will be notified. You cannot approve your own policy." />}
      {dialog === 'publish' && <ConfirmDialog title="Approve and publish" variant="success" confirmLabel="Publish policy" onConfirm={() => run('publish', (r) => `Published. ${r.supersededVersion ? `${r.supersededVersion} is now superseded (kept for history). ` : ''}${r.batchesNeedingRevalidation} batch(es) must be revalidated.`)} onClose={() => setDialog(null)} busy={action.busy} error={action.error}
        message="This becomes the active policy for the academic year: seat ledgers take the new capacities and the previous version is retained as SUPERSEDED. Batches validated under the old version will need revalidation." />}
      {dialog === 'reject' && <ReasonDialog title="Return to draft" variant="danger" confirmLabel="Return to author" onSubmit={(reason) => run('reject', 'Returned to the author.', { reason })} onClose={() => setDialog(null)} busy={action.busy} error={action.error} />}
    </>
  );
}

const EMPTY_BUCKET = { code: '', capacity: 0, countsWithinIntake: true };

export function PolicyEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  useDocumentTitle(editing ? 'Edit seat policy draft' : 'Create seat policy draft');
  const navigate = useNavigate();
  const policies = useApi(() => api('/admin/seat-policies'), []);
  const existing = useApi(() => (editing ? api(`/admin/seat-policies/${id}`) : Promise.resolve(null)), [id, editing]);
  const [form, setForm] = useState(null);
  const action = useAction();

  useEffect(() => {
    if (editing && existing.data) setForm({ ...existing.data });
  }, [editing, existing.data]);

  function startFrom(policy) {
    setForm({
      academicYear: policy?.academicYear || '2026-27', version: '', sourceReference: '', notes: '',
      admissionWindow: policy?.admissionWindow || { opensOn: '2026-07-01', closesOn: '2026-09-30' },
      scopes: policy ? JSON.parse(JSON.stringify(policy.scopes)) : [{ institutionCode: '', courseCode: '', buckets: [{ ...EMPTY_BUCKET }] }],
    });
  }

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  function updateBucket(scopeIndex, bucketIndex, key, value) {
    setForm((f) => {
      const scopes = JSON.parse(JSON.stringify(f.scopes));
      scopes[scopeIndex].buckets[bucketIndex][key] = value;
      return { ...f, scopes };
    });
  }
  function updateScope(scopeIndex, key, value) {
    setForm((f) => {
      const scopes = JSON.parse(JSON.stringify(f.scopes));
      scopes[scopeIndex][key] = value;
      return { ...f, scopes };
    });
  }

  async function save() {
    const scopes = form.scopes.map((s) => ({ institutionCode: s.institutionCode, courseCode: s.courseCode, buckets: s.buckets.map((b) => ({ code: b.code, capacity: Number(b.capacity), countsWithinIntake: Boolean(b.countsWithinIntake) })) }));
    const body = editing
      ? { sourceReference: form.sourceReference, notes: form.notes || '', admissionWindow: form.admissionWindow, scopes }
      : { academicYear: form.academicYear, version: form.version, sourceReference: form.sourceReference, notes: form.notes || '', admissionWindow: form.admissionWindow, scopes };
    const result = await action.run(() => (editing ? api(`/admin/seat-policies/${id}`, { method: 'PATCH', body }) : api('/admin/seat-policies', { method: 'POST', body })), { success: 'Draft saved. Run "Validate rules" next.', onError: () => {} });
    if (result) navigate(`/admin/policies/${result.id}`);
  }

  if (!form) {
    return (
      <>
        <PageHeader title="Create seat policy draft" breadcrumbs={[{ label: 'Seat policies', to: '/admin/policies' }, { label: 'New draft' }]} />
        <DataState loading={policies.loading || existing.loading} error={policies.error || existing.error} hasData={Boolean(policies.data)}>
          {!editing && policies.data && (
            <section className="card-gov">
              <h2>Start from</h2>
              <p>Copy an existing version and change only what you need. Drafts never affect validation until published.</p>
              <div className="d-flex flex-wrap gap-2">
                {policies.data.items.map((p) => <Button key={p.id} variant="outline-primary" onClick={() => startFrom(p)}>{p.version} ({p.status.toLowerCase()})</Button>)}
                <Button variant="link" onClick={() => startFrom(null)}>Start empty</Button>
              </div>
            </section>
          )}
        </DataState>
      </>
    );
  }

  return (
    <>
      <PageHeader title={editing ? `Edit draft ${form.version}` : 'Create seat policy draft'} breadcrumbs={[{ label: 'Seat policies', to: '/admin/policies' }, { label: editing ? form.version : 'New draft' }]} />
      <Alert kind="warning" className="mb-3">Use only synthetic demo capacities with a clear source reference (fixture ID). Never enter unverified official quota percentages.</Alert>
      <section className="card-gov">
        <div className="row">
          <div className="col-md-3"><TextField label="Academic year" value={form.academicYear} onChange={(v) => set('academicYear', v)} required disabled={editing} /></div>
          <div className="col-md-3"><TextField label="Version label" value={form.version} onChange={(v) => set('version', v)} required disabled={editing} hint="e.g. DEMO-v3" /></div>
          <div className="col-md-3"><TextField label="Admission window opens" type="date" value={form.admissionWindow.opensOn} onChange={(v) => set('admissionWindow', { ...form.admissionWindow, opensOn: v })} required /></div>
          <div className="col-md-3"><TextField label="Admission window closes" type="date" value={form.admissionWindow.closesOn} onChange={(v) => set('admissionWindow', { ...form.admissionWindow, closesOn: v })} required /></div>
        </div>
        <TextField label="Source reference" value={form.sourceReference} onChange={(v) => set('sourceReference', v)} required hint="Demo fixture ID or approval reference." />
        <TextAreaField label="Notes" value={form.notes} onChange={(v) => set('notes', v)} />
      </section>
      <section className="card-gov">
        <h2>Institution / course scopes</h2>
        {form.scopes.map((scope, scopeIndex) => (
          <fieldset key={scopeIndex} className="border rounded p-3 mb-3">
            <legend className="fs-6 fw-semibold w-auto px-1">Scope {scopeIndex + 1}</legend>
            <div className="row g-2 mb-2">
              <div className="col-md-4"><label className="form-label small" htmlFor={`sc-i-${scopeIndex}`}>Institution code</label><input id={`sc-i-${scopeIndex}`} className="form-control" value={scope.institutionCode} onChange={(e) => updateScope(scopeIndex, 'institutionCode', e.target.value.toUpperCase())} /></div>
              <div className="col-md-4"><label className="form-label small" htmlFor={`sc-c-${scopeIndex}`}>Course code</label><input id={`sc-c-${scopeIndex}`} className="form-control" value={scope.courseCode} onChange={(e) => updateScope(scopeIndex, 'courseCode', e.target.value.toUpperCase())} /></div>
              <div className="col-md-4 d-flex align-items-end"><Button variant="link" onClick={() => set('scopes', form.scopes.filter((_, i) => i !== scopeIndex))}>Remove scope</Button></div>
            </div>
            <table className="table table-sm">
              <thead><tr><th>Bucket code</th><th>Capacity</th><th>Counts within intake</th><th><span className="visually-hidden">Remove</span></th></tr></thead>
              <tbody>
                {scope.buckets.map((bucket, bucketIndex) => (
                  <tr key={bucketIndex}>
                    <td><input aria-label="Bucket code" className="form-control form-control-sm" value={bucket.code} onChange={(e) => updateBucket(scopeIndex, bucketIndex, 'code', e.target.value.toUpperCase())} /></td>
                    <td><input aria-label="Capacity" type="number" min="0" className="form-control form-control-sm" value={bucket.capacity} onChange={(e) => updateBucket(scopeIndex, bucketIndex, 'capacity', e.target.value)} /></td>
                    <td><input aria-label="Counts within intake" type="checkbox" className="form-check-input" checked={bucket.countsWithinIntake} onChange={(e) => updateBucket(scopeIndex, bucketIndex, 'countsWithinIntake', e.target.checked)} /></td>
                    <td><Button size="sm" variant="link" onClick={() => updateScope(scopeIndex, 'buckets', scope.buckets.filter((_, i) => i !== bucketIndex))}>Remove</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button size="sm" variant="outline-primary" icon="plus" onClick={() => updateScope(scopeIndex, 'buckets', [...scope.buckets, { ...EMPTY_BUCKET }])}>Add bucket</Button>
          </fieldset>
        ))}
        <Button variant="outline-primary" icon="plus-lg" onClick={() => set('scopes', [...form.scopes, { institutionCode: '', courseCode: '', buckets: [{ ...EMPTY_BUCKET }] }])}>Add scope</Button>
      </section>
      <ErrorAlert error={action.error} />
      <div className="d-flex gap-2">
        <Button icon="save" onClick={save} loading={action.busy}>Save draft</Button>
        <Button variant="outline-primary" onClick={() => navigate(editing ? `/admin/policies/${id}` : '/admin/policies')}>Cancel</Button>
      </div>
    </>
  );
}

export function PolicyComparePage() {
  const { base } = usePolicyBase();
  useDocumentTitle('Compare seat policies');
  const [params] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const comparison = useApi(() => api(`/admin/seat-policies/compare?from=${from}&to=${to}`), [from, to]);
  const data = comparison.data;
  return (
    <>
      <PageHeader title="Compare seat-policy versions" breadcrumbs={[{ label: 'Seat policies', to: base }, { label: 'Compare' }]} />
      <DataState loading={comparison.loading} error={comparison.error} onRetry={comparison.reload} hasData={Boolean(data)}>
        {data && (
          <>
            <section className="card-gov">
              <h2>{data.from.version} → {data.to.version}</h2>
              <DataTable rowKey={(m) => m.field} rows={data.metadata} columns={[
                { key: 'field', header: 'Field' },
                { key: 'from', header: data.from.version, render: (m) => (typeof m.from === 'object' ? JSON.stringify(m.from) : String(m.from ?? '-')) },
                { key: 'to', header: data.to.version, render: (m) => (typeof m.to === 'object' ? JSON.stringify(m.to) : String(m.to ?? '-')) },
                { key: 'changed', header: 'Changed?', render: (m) => (m.changed ? <StatusBadge status="WARNING" label="Changed" /> : 'No') },
              ]} />
            </section>
            <section className="card-gov">
              <h2>Capacity differences</h2>
              {data.differences.length === 0 ? <p className="text-muted mb-0">No capacity differences.</p> : (
                <DataTable rowKey={(d) => d.key} rows={data.differences} columns={[
                  { key: 'key', header: 'Institution / course / bucket' },
                  { key: 'change', header: 'Change' },
                  { key: 'from', header: data.from.version, render: (d) => (d.from ? `${d.from.capacity}${d.from.countsWithinIntake ? '' : ' (additional)'}` : '-') },
                  { key: 'to', header: data.to.version, render: (d) => (d.to ? `${d.to.capacity}${d.to.countsWithinIntake ? '' : ' (additional)'}` : '-') },
                ]} />
              )}
            </section>
          </>
        )}
      </DataState>
    </>
  );
}
