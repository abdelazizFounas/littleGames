import { Link, Navigate, useSearchParams } from 'react-router';
import { SignInPanel } from '../features/auth/sign-in-panel';
import { useSession } from '../session/use-session';
export function LoginRoute() {
  const { state } = useSession();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  const destination = next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.startsWith('/login') ? next : '/';
  if (state.status === 'signed-in') return <Navigate to={destination} replace/>;
  return <div className="auth-page"><p className="eyebrow">YOUR NEXT RIVALRY STARTS HERE</p><SignInPanel/><Link className="text-link" to="/practice/arena">Or try practice without signing in →</Link></div>;
}
