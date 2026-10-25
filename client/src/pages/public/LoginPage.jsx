import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../services/apiClient';
import { useAuth, ROLE_HOME, ROLE_LABELS } from '../../features/auth/AuthContext';
import { usePreferences } from '../../features/preferences/PreferencesContext';
import { useApi, useDocumentTitle } from '../../hooks/useApi';
import { Alert, Button, ErrorAlert, Icon } from '../../components/ui';

export function validateLogin({ email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = 'Enter your email address.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address, for example name@example.test.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

// Prototype demos only: one button per role signs in to a seeded demo account. Further accounts
// for a role (a second college, a second administrator) are folded under "More demo accounts".
function DemoAccess({ accounts, busyEmail, error, onSignIn }) {
  const { t } = usePreferences();
  const seenRoles = new Set();
  const main = [];
  const more = [];
  for (const account of accounts) {
    (seenRoles.has(account.role) ? more : main).push(account);
    seenRoles.add(account.role);
  }
  const renderButton = (account) => (
    <button
      key={account.email} type="button" className="demo-account" data-role={account.role} onClick={() => onSignIn(account.email)}
      disabled={Boolean(busyEmail)} aria-busy={busyEmail === account.email ? 'true' : undefined}
    >
      <span className="demo-account-role">{ROLE_LABELS[account.role] || account.role}</span>{' '}
      <span className="demo-account-scope">{account.scope}</span>
    </button>
  );
  return (
    <section className="card-gov h-100" aria-labelledby="demo-access-heading">
      <h2 id="demo-access-heading" className="h3">{t('demoAccessTitle')}</h2>
      <p className="small text-muted">{t('demoAccessNote')}</p>
      <ErrorAlert error={error} className="mb-3" />
      <div className="demo-account-grid">{main.map(renderButton)}</div>
      {more.length > 0 && (
        <details className="demo-more mt-3">
          <summary>{t('demoMoreAccounts')}</summary>
          <div className="demo-account-grid mt-2">{more.map(renderButton)}</div>
        </details>
      )}
    </section>
  );
}

export default function LoginPage() {
  useDocumentTitle('Sign in');
  const { user, login, demoLogin, sessionMessage } = useAuth();
  const { t } = usePreferences();
  const navigate = useNavigate();
  const location = useLocation();
  const demo = useApi(() => api('/auth/demo-accounts'), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoBusy, setDemoBusy] = useState(null);
  const [demoError, setDemoError] = useState(null);

  if (user && !submitting) return <Navigate to={ROLE_HOME[user.role]} replace />;

  const demoAccounts = demo.data?.enabled ? demo.data.accounts : [];
  const showDemo = demoAccounts.length > 0;

  // The check above sends the newly signed-in user to their dashboard.
  async function handleDemoSignIn(accountEmail) {
    if (demoBusy) return;
    setDemoBusy(accountEmail);
    setDemoError(null);
    try {
      await demoLogin(accountEmail);
    } catch (error) {
      setDemoError(error);
    } finally {
      setDemoBusy(null);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return; // prevent duplicate submissions
    const found = validateLogin({ email, password });
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      const signedIn = await login(email.trim(), password);
      const from = location.state?.from;
      navigate(from && from !== '/login' ? from : ROLE_HOME[signedIn.role], { replace: true });
    } catch (error) {
      setServerError(error);
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="row justify-content-center">
      <div className={showDemo ? 'col-xl-11' : 'col-md-8 col-lg-6'}>
        <h1 className="h2 mb-3">{t('signInTitle')}</h1>
        {location.state?.message && <Alert kind="success" className="mb-3">{location.state.message}</Alert>}
        {sessionMessage && !location.state?.message && <Alert kind="warning" className="mb-3">{sessionMessage}</Alert>}
        <div className="row g-4">
          {showDemo && (
            <div className="col-lg-7">
              <DemoAccess accounts={demoAccounts} busyEmail={demoBusy} error={demoError} onSignIn={handleDemoSignIn} />
            </div>
          )}
          <div className={showDemo ? 'col-lg-5' : 'col-12'}>
            <div className="card-gov h-100">
              <h2 className="h3">{t('passwordSignInTitle')}</h2>
              <form onSubmit={handleSubmit} noValidate>
                <div className="mb-3">
                  <label className="form-label" htmlFor="login-email">{t('email')}<span className="required-mark" aria-hidden="true">*</span><span className="visually-hidden"> (required)</span></label>
                  <input
                    id="login-email" type="email" autoComplete="username" className={`form-control ${errors.email ? 'is-invalid' : ''}`}
                    value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={errors.email ? 'true' : undefined}
                    aria-describedby={errors.email ? 'login-email-error' : undefined} required
                  />
                  {errors.email && <div className="field-error" id="login-email-error"><Icon name="exclamation-circle" /> {errors.email}</div>}
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="login-password">{t('password')}<span className="required-mark" aria-hidden="true">*</span><span className="visually-hidden"> (required)</span></label>
                  <input
                    id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" className={`form-control ${errors.password ? 'is-invalid' : ''}`}
                    value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={errors.password ? 'true' : undefined}
                    aria-describedby={errors.password ? 'login-password-error' : undefined} required
                  />
                  {errors.password && <div className="field-error" id="login-password-error"><Icon name="exclamation-circle" /> {errors.password}</div>}
                  <div className="form-check mt-2">
                    <input id="show-password" type="checkbox" className="form-check-input" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
                    <label className="form-check-label" htmlFor="show-password">{t('showPassword')}</label>
                  </div>
                </div>
                <ErrorAlert error={serverError} className="mb-3" />
                <Button type="submit" variant="accent" icon="box-arrow-in-right" loading={submitting} loadingText="Signing in...">{t('signIn')}</Button>
              </form>
              <hr />
              <p className="small mb-1"><strong>Forgot your password?</strong> Self-service recovery is not part of this prototype. Ask the system administrator to start a controlled reset; you will receive a one-time link.</p>
              <p className="small text-muted mb-0">Demo accounts are created with <code>npm run seed</code>. Their passwords are printed only in the developer&apos;s terminal and are never shown on this page.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
