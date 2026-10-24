import { Link } from 'react-router-dom';
import { useAuth, ROLE_HOME } from '../../features/auth/AuthContext';
import { useDocumentTitle } from '../../hooks/useApi';
import { Icon } from '../../components/ui';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  const { user } = useAuth();
  return (
    <div className="card-gov text-center py-5">
      <Icon name="signpost-split" className="fs-1 d-block mb-2" />
      <h1>Page not found</h1>
      <p className="text-muted">The address may be mistyped, or the page may have moved.</p>
      <Link className="btn btn-primary" to={user ? ROLE_HOME[user.role] : '/'}>Go to {user ? 'my dashboard' : 'the home page'}</Link>
    </div>
  );
}

export function UnauthorizedPage() {
  useDocumentTitle('Not permitted');
  const { user } = useAuth();
  return (
    <div className="card-gov text-center py-5">
      <Icon name="shield-lock" className="fs-1 d-block mb-2" />
      <h1>You do not have access to this page</h1>
      <p className="text-muted">Your role does not include this function. If you believe this is wrong, contact the system administrator.</p>
      <Link className="btn btn-primary" to={user ? ROLE_HOME[user.role] : '/login'}>{user ? 'Back to my dashboard' : 'Sign in'}</Link>
    </div>
  );
}
