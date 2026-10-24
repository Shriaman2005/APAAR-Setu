import { useState } from 'react';
import { api, setCsrfToken } from '../../services/apiClient';
import { useAuth, ROLE_LABELS } from '../../features/auth/AuthContext';
import { useDocumentTitle } from '../../hooks/useApi';
import { TextField } from '../../components/forms';
import { Alert, Button, ErrorAlert, KeyValue, PageHeader } from '../../components/ui';
import { passwordProblems } from '../public/SetPasswordPage';

export default function AccountPage() {
  useDocumentTitle('My account');
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const problems = passwordProblems(next);

  async function submit(event) {
    event.preventDefault();
    setTouched(true);
    setSaved(false);
    if (!current || problems.length || next !== confirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setCsrfToken(result.csrfToken);
      setSaved(true);
      setCurrent(''); setNext(''); setConfirm(''); setTouched(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="My account" />
      <div className="row g-3">
        <div className="col-lg-5">
          <section className="card-gov">
            <h2>Profile</h2>
            <KeyValue items={[
              ['Name', user.displayName],
              ['Email', user.email],
              ['Role', ROLE_LABELS[user.role]],
              user.institution && ['Institution', `${user.institution.name} (${user.institution.code})`],
              user.regionIds?.length > 0 && ['Regions', user.regionIds.join(', ')],
              user.organisation && ['Organisation', `${user.organisation.name} (${user.organisation.status})`],
            ]} />
            <p className="small text-muted mt-3 mb-0">Your role and scope are set by the system administrator and cannot be changed here.</p>
          </section>
        </div>
        <div className="col-lg-7">
          <form className="card-gov" onSubmit={submit} noValidate>
            <h2>Change password</h2>
            {saved && <Alert kind="success" className="mb-3">Password changed. Other signed-in sessions have been signed out.</Alert>}
            <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={setCurrent} required error={touched && !current ? 'Enter your current password.' : null} />
            <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={setNext} required hint="At least 12 characters with letters and digits." error={touched && problems.length ? `Password needs ${problems.join(', ')}.` : null} />
            <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} required error={touched && confirm !== next ? 'The passwords do not match.' : null} />
            <ErrorAlert error={error} className="mb-3" />
            <Button type="submit" icon="key" loading={busy} loadingText="Saving...">Change password</Button>
          </form>
        </div>
      </div>
    </>
  );
}
