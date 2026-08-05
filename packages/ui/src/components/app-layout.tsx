import { displayNameOf } from '@littlegames/net';
import type { ReactNode } from 'react';
import { Link, Outlet } from 'react-router';
import { useAsyncAction } from '../lib/use-async-action';
import { useSession } from '../session/use-session';

/**
 * Frame shared by every screen.
 *
 * The player's identity and the way out live here rather than on the home
 * screen, so they stay reachable from the catalogue, a game and the profile
 * alike.
 */
export function AppLayout(): ReactNode {
  const { state, signOutPlayer } = useSession();
  const signOut = useAsyncAction('Could not sign out.');

  return (
    <>
      <header className="masthead">
        <Link className="masthead__brand" to="/">
          LittleGames
        </Link>
        {state.status === 'signed-in' && (
          <nav className="masthead__nav">
            <Link to="/profile">{displayNameOf(state.profile)}</Link>
            <button
              type="button"
              className="link-button link-button--inline"
              disabled={signOut.pending}
              onClick={() => {
                signOut.run(signOutPlayer);
              }}
            >
              {signOut.pending ? 'Signing out…' : 'Sign out'}
            </button>
          </nav>
        )}
      </header>

      {signOut.error !== null && (
        <p role="alert" className="error error--banner">
          {signOut.error}
        </p>
      )}

      <main className="app">
        <Outlet />
      </main>
    </>
  );
}
