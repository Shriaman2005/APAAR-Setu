import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { LoadingBlock } from '../components/ui';

/**
 * Keeps signed-out users and wrong roles away from pages they cannot use.
 * This is a user-experience measure only; every API call is authorised on the server.
 */
export default function ProtectedRoute({ roles }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingBlock text="Checking your session..." />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}
