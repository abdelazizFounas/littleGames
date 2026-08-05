import { displayNameOf } from '@littlegames/net';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { SignInPanel } from '../features/auth/sign-in-panel';
import { useAsyncAction } from '../lib/use-async-action';
import { useSession } from '../session/use-session';

export function HomeRoute(): ReactNode {
  const { state, signOutPlayer } = useSession();
  const signOut = useAsyncAction('Could not sign out.');

  if (state.status === 'loading') {
    return (
      <section className="panel">
        <p className="lede">Loading…</p>
      </section>
    );
  }

  if (state.status === 'signed-out') {
    return <SignInPanel />;
  }

  return (
    <section className="panel">
      <p className="eyebrow">Signed in as</p>
      <h1>{displayNameOf(state.profile)}</h1>
      {state.profile.isGuest && (
        <p className="hint">
          You are playing as a guest. <Link to="/profile">Secure your account</Link> to keep it.
        </p>
      )}

      <nav className="actions">
        <Link className="button" to="/profile">
          Profile
        </Link>
        <button
          type="button"
          className="link-button"
          disabled={signOut.pending}
          onClick={() => {
            signOut.run(signOutPlayer);
          }}
        >
          {signOut.pending ? 'Signing out…' : 'Sign out'}
        </button>
      </nav>
      {signOut.error !== null && <p role="alert" className="error">{signOut.error}</p>}
    </section>
  );
}
