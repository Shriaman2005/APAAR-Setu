import { useState } from 'react';
import { api, toQuery } from '../../services/apiClient';
import { useAction, useApi, useDocumentTitle } from '../../hooks/useApi';
import { useAuth, ROLE_LABELS } from '../../features/auth/AuthContext';
import Modal from '../../components/Modal';
import { ConfirmDialog, ReasonDialog, SelectField, TextField } from '../../components/forms';
import { Alert, Button, DataState, DataTable, ErrorAlert, PageHeader, Pagination, StatusBadge, formatDate } from '../../components/ui';

const ROLES = Object.keys(ROLE_LABELS);

function OneTimeLink({ title, link, note, expiresAt, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<Button onClick={onClose}>I have saved the link</Button>}>
      <Alert kind="warning" className="mb-3">{note}</Alert>
      <label className="form-label" htmlFor="one-time-link">One-time link (expires {formatDate(expiresAt, true)})</label>
      <textarea id="one-time-link" className="form-control mono" readOnly rows={3} value={link} onFocus={(e) => e.target.select()} />
      <Button className="mt-2" variant="outline-primary" icon="clipboard" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy link'}</Button>
    </Modal>
  );
}

function UserForm({ existing, reference, onClose, onSaved }) {
  const [form, setForm] = useState(existing
    ? { displayName: existing.displayName, institutionId: existing.institutionId || '', regionIds: existing.regionIds || [], organisationId: existing.organisationId || '' }
    : { email: '', displayName: '', role: 'COLLEGE_OPERATOR', institutionId: '', regionIds: [], organisationId: '', studentCode: '' });
  const action = useAction();
  const role = existing ? existing.role : form.role;
  const scope = reference.roles.find((r) => r.role === role)?.scope || {};
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const fieldErrors = action.error?.details?.fieldErrors || {};

  async function submit() {
    const body = existing ? { displayName: form.displayName } : { email: form.email, displayName: form.displayName, role: form.role };
    if (scope.institution) body.institutionId = form.institutionId || undefined;
    if (scope.regions) body.regionIds = form.regionIds;
    if (scope.organisation) body.organisationId = form.organisationId || undefined;
    if (!existing && scope.student) body.studentCode = form.studentCode;
    const result = await action.run(() => (existing ? api(`/admin/users/${existing.id}`, { method: 'PATCH', body }) : api('/admin/users', { method: 'POST', body })), { success: existing ? 'User updated.' : 'User created (pending activation).', onError: () => {} });
    if (result) onSaved(result);
  }

  return (
    <Modal title={existing ? `Edit ${existing.email}` : 'Create user'} size="lg" onClose={onClose} busy={action.busy} footer={(
      <>
        <Button onClick={submit} loading={action.busy} icon="save">{existing ? 'Save changes' : 'Create user'}</Button>
        <Button variant="outline-primary" onClick={onClose} disabled={action.busy}>Cancel</Button>
      </>
    )}>
      {!existing && <TextField label="Email" type="email" value={form.email} onChange={(v) => set('email', v)} required error={fieldErrors.email?.[0]} />}
      <TextField label="Display name" value={form.displayName} onChange={(v) => set('displayName', v)} required error={fieldErrors.displayName?.[0]} />
      {existing ? (
        <p><strong>Role:</strong> {ROLE_LABELS[existing.role]} <span className="small text-muted">(roles cannot be changed; create a new account instead)</span></p>
      ) : (
        <SelectField label="Role (allow-listed)" value={form.role} onChange={(v) => set('role', v)} required options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
      )}
      {scope.institution && (
        <SelectField label="Institution" value={form.institutionId} onChange={(v) => set('institutionId', v)} required placeholder="Choose institution" error={fieldErrors.institutionId?.[0]}
          options={reference.institutions.map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))} />
      )}
      {scope.regions && (
        <fieldset className="mb-3">
          <legend className="form-label fs-6">Regions<span className="required-mark">*</span></legend>
          {reference.regions.map((r) => (
            <div className="form-check" key={r.regionId}>
              <input id={`reg-${r.regionId}`} type="checkbox" className="form-check-input" checked={form.regionIds.includes(r.regionId)}
                onChange={(e) => set('regionIds', e.target.checked ? [...form.regionIds, r.regionId] : form.regionIds.filter((x) => x !== r.regionId))} />
              <label className="form-check-label" htmlFor={`reg-${r.regionId}`}>{r.name} ({r.regionId})</label>
            </div>
          ))}
          {fieldErrors.regionIds && <div className="field-error">{fieldErrors.regionIds[0]}</div>}
        </fieldset>
      )}
      {scope.organisation && (
        <SelectField label={`Organisation${scope.organisation === 'optional' ? ' (optional - verifier can onboard later)' : ''}`} value={form.organisationId} onChange={(v) => set('organisationId', v)}
          required={scope.organisation === 'required'} placeholder="Choose organisation" error={fieldErrors.organisationId?.[0]}
          options={reference.organisations.filter((o) => o.type === scope.organisationType).map((o) => ({ value: o.id, label: `${o.name} (${o.code}, ${o.status})` }))} />
      )}
      {!existing && scope.student && (
        <TextField label="Student code in the register" value={form.studentCode} onChange={(v) => set('studentCode', v.toUpperCase())} required hint="The student must already exist in the register and have no login yet." error={fieldErrors.studentCode?.[0]} />
      )}
      {!existing && <p className="small text-muted">The account starts as PENDING_ACTIVATION. You will receive a one-time activation link to hand over securely (no email is sent).</p>}
      <ErrorAlert error={action.error} />
    </Modal>
  );
}

export default function UsersPage() {
  useDocumentTitle('Users');
  const { user: me } = useAuth();
  const [filters, setFilters] = useState({ role: '', status: '', search: '', page: 1 });
  const [searchText, setSearchText] = useState('');
  const list = useApi(() => api(`/admin/users${toQuery(filters)}`), [filters]);
  const reference = useApi(() => api('/admin/reference-data'), []);
  const [editing, setEditing] = useState(null); // 'new' | user
  const [statusChange, setStatusChange] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [linkInfo, setLinkInfo] = useState(null);
  const action = useAction();
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value, page: 1 }));

  async function changeStatus(reason) {
    const path = statusChange.enable ? 'enable' : 'disable';
    const done = await action.run(() => api(`/admin/users/${statusChange.user.id}/${path}`, { method: 'POST', body: { reason } }), { success: statusChange.enable ? 'Account re-enabled.' : 'Account disabled; its sessions have ended.', onError: () => {} });
    if (done) { setStatusChange(null); list.reload(); }
  }
  async function resetPassword() {
    const result = await action.run(() => api(`/admin/users/${resetTarget.id}/password-reset`, { method: 'POST' }), { onError: () => {} });
    if (result) { setResetTarget(null); setLinkInfo({ title: 'Password reset link', link: result.resetLink, note: result.deliveryNote, expiresAt: result.expiresAt }); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Users" subtitle="Accounts and role assignments. Password hashes are never shown or retrievable." onRefresh={list.reload} refreshing={list.loading}
        actions={<Button icon="person-plus" onClick={() => setEditing('new')} disabled={!reference.data}>Create user</Button>} />
      <form className="row g-2 align-items-end mb-3" onSubmit={(e) => { e.preventDefault(); set('search', searchText.trim()); }}>
        <div className="col-6 col-md-3"><label className="form-label" htmlFor="u-role">Role</label>
          <select id="u-role" className="form-select" value={filters.role} onChange={(e) => set('role', e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
        <div className="col-6 col-md-2"><label className="form-label" htmlFor="u-status">Status</label>
          <select id="u-status" className="form-select" value={filters.status} onChange={(e) => set('status', e.target.value)}><option value="">All</option><option value="ACTIVE">Active</option><option value="PENDING_ACTIVATION">Pending activation</option><option value="DISABLED">Disabled</option></select></div>
        <div className="col-8 col-md-4"><label className="form-label" htmlFor="u-search">Search email or name</label><input id="u-search" className="form-control" value={searchText} onChange={(e) => setSearchText(e.target.value)} /></div>
        <div className="col-4 col-md-3 d-flex gap-2"><Button type="submit" icon="search">Search</Button><Button variant="link" onClick={() => { setSearchText(''); setFilters({ role: '', status: '', search: '', page: 1 }); }}>Clear</Button></div>
      </form>
      <DataState loading={list.loading} error={list.error} onRetry={list.reload} hasData={Boolean(list.data)} empty={list.data?.items.length === 0} emptyTitle="No users match">
        {list.data && (
          <>
            <DataTable caption="Users" rowKey={(u) => u.id} rows={list.data.items} columns={[
              { key: 'user', header: 'User', render: (u) => <>{u.displayName}<div className="small text-muted">{u.email}</div></> },
              { key: 'role', header: 'Role', render: (u) => ROLE_LABELS[u.role] },
              { key: 'scope', header: 'Scope', render: (u) => u.institutionCode || (u.regionIds.length ? u.regionIds.join(', ') : '') || u.organisationCode || (u.hasStudentLink ? 'Own student record' : 'National / system') },
              { key: 'status', header: 'Status', render: (u) => <><StatusBadge status={u.status} />{u.disabledReason && <div className="small text-muted">{u.disabledReason}</div>}</> },
              { key: 'lastLoginAt', header: 'Last sign-in', render: (u) => formatDate(u.lastLoginAt, true) },
              { key: 'actions', header: 'Actions', render: (u) => (
                <div className="d-flex flex-wrap gap-1">
                  <Button size="sm" variant="outline-primary" onClick={() => setEditing(u)} disabled={!reference.data}>Edit</Button>
                  {u.id !== me.id && (u.status === 'DISABLED'
                    ? <Button size="sm" variant="success" onClick={() => setStatusChange({ user: u, enable: true })}>Re-enable</Button>
                    : <Button size="sm" variant="outline-danger" onClick={() => setStatusChange({ user: u, enable: false })}>Disable</Button>)}
                  {u.id !== me.id && u.status !== 'DISABLED' && <Button size="sm" variant="link" onClick={() => setResetTarget(u)}>Reset password</Button>}
                </div>
              ) },
            ]} />
            <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
          </>
        )}
      </DataState>

      {editing && reference.data && (
        <UserForm existing={editing === 'new' ? null : editing} reference={reference.data} onClose={() => setEditing(null)}
          onSaved={(result) => { setEditing(null); list.reload(); if (result.activationLink) setLinkInfo({ title: 'Account created - activation link', link: result.activationLink, note: result.deliveryNote, expiresAt: result.activationExpiresAt }); }} />
      )}
      {statusChange && (
        <ReasonDialog title={statusChange.enable ? `Re-enable ${statusChange.user.email}` : `Disable ${statusChange.user.email}`} variant={statusChange.enable ? 'success' : 'danger'}
          confirmLabel={statusChange.enable ? 'Re-enable account' : 'Disable account'}
          description={statusChange.enable ? 'The user can sign in again.' : 'The user is signed out everywhere immediately and cannot sign in until re-enabled.'}
          onSubmit={changeStatus} onClose={() => { setStatusChange(null); action.setError(null); }} busy={action.busy} error={action.error} />
      )}
      {resetTarget && (
        <ConfirmDialog title={`Reset password for ${resetTarget.email}`} variant="danger" confirmLabel="Generate reset link" onConfirm={resetPassword} onClose={() => { setResetTarget(null); action.setError(null); }} busy={action.busy} error={action.error}
          message="The current password stops working and all sessions end. You will get a one-time link (valid 24 hours) to give to the user. The old password is never shown." />
      )}
      {linkInfo && <OneTimeLink {...linkInfo} onClose={() => setLinkInfo(null)} />}
    </>
  );
}
