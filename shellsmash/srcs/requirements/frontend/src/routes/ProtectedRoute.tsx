import { Navigate } from 'react-router-dom';
import { RouteLoading } from '../components/common/RouteLoading';
import { useSessionGate } from '../hooks/useSessionGate';

interface ProtectedRouteProps {
  children: JSX.Element;
}

export function ProtectedRoute({ children }: ProtectedRouteProps): JSX.Element {
  const { status } = useSessionGate();

  if (status === 'checking') {
    return <RouteLoading />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/auth" replace />;
  }

  return children;
}
