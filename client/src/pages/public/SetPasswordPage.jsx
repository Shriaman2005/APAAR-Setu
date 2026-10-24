import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../services/apiClient';
import { useDocumentTitle } from '../../hooks/useApi';
import { TextField } from '../../components/forms';
import { Alert, Button, ErrorAlert } from '../../components/ui';

export function passwordProblems(password) {
  const problems = [];
  if (password.length < 12) problems.push('at least 12 characters');
  if (!/[A-Za-z]/.test(password)) problems.push('a letter');
  if (!/\d/.test(password)) problems.push('a digit');
  return problems;
}

// Completes account activation or an administrator-initiated reset with a one-time link.
export default function SetPasswordPage() {
  useDocumentTitle('Set your password');
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const problems = passwordProblems(password);
  const mismatch = confirm !== password;

  async function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (problems.length || mismatch || busy) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api('/auth/set-password', { method: 'POST', body: { token, newPassword: password } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Alert kind="error" title="Link incomplete">This page needs the one-time link sent by your administrator.</Alert>;
  if (done) {
    return (
      <div className="card-gov">
        <h1 className="h2">Password saved</h1>
        <Alert kind="success">Your password has been set{done.purpose === 'ACTIVATION' ? ' and your account is now active' : ''}. The link cannot be used again.</Alert>
        <Link className="btn btn-accent mt-3" to="/login">Go to sign in</Link>
      </div>
    );
  }
  return (
    <div className="row justify-content-center">
      <div className="col-md-8 col-lg-6">
        <form className="card-gov" onSubmit={submit} noValidate>
          <h1 className="h2">Set your password</h1>
          <p className="text-muted">Use at least 12 characters with letters and digits. Do not reuse a password from another site.</p>
          <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={setPassword} required
            error={touched && problems.length ? `Password needs ${problems.join(', ')}.` : null} />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} required
            error={touched && mismatch ? 'The passwords do not match.' : null} />
          <ErrorAlert error={error} className="mb-3" />
          <Button type="submit" icon="key" loading={busy} loadingText="Saving...">Save password</Button>
        </form>
      </div>
    </div>
  );
}
