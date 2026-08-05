import { useCallback, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useAsyncData } from '../lib/use-async-data';
import { useSession } from '../session/use-session';

/**
 * The screen an invitation link lands on.
 *
 * This is the most-shared address the product has, so every way it can go wrong
 * says what went wrong. A link cut short in a chat, one opened a day later, one
 * for a match that has since ended: each gets its own sentence rather than a
 * blank screen.
 */
export function JoinRoute(): ReactNode {
  const { code } = useParams();
  const { state, signInAsGuest, resolveInvitation } = useSession();

  const load = useCallback(async () => {
    if (code === undefined || code.length === 0) {
      throw new Error('That link is missing its invitation code.');
    }
    return resolveInvitation(code);
  }, [code, resolveInvitation]);

  const resolved = useAsyncData(load, 'That invitation could not be opened.');

  if (state.status === 'loading') {
    return (
      <section className="panel">
        <p className="lede">Loading…</p>
      </section>
    );
  }

  // Someone arriving from a link may have no account at all. Asking them to
  // make one first is how an invitation gets abandoned, so a single click is
  // enough and the guest account can gain an email later.
  if (state.status === 'signed-out') {
    return (
      <section className="panel">
        <p className="eyebrow">Invitation</p>
        <h1>You have been invited to play</h1>
        <p className="hint">No account needed. One click and you are in.</p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            void signInAsGuest();
          }}
        >
          Join as guest
        </button>
      </section>
    );
  }

  if (resolved.status === 'loading') {
    return (
      <section className="panel">
        <p className="lede">Opening the invitation…</p>
      </section>
    );
  }

  if (resolved.status === 'failed') {
    return (
      <section className="panel">
        <p className="eyebrow">Invitation</p>
        <h1>This link did not work</h1>
        <p role="alert" className="error">
          {resolved.error}
        </p>
        <Link className="button" to="/">
          Back to the games
        </Link>
      </section>
    );
  }

  // Replace rather than push: going back should return to wherever the link was
  // opened from, not to a code that has now been used.
  // The password rides along in the URL because the invitation already granted
  // it: the host chose to let this person past the door.
  const query = new URLSearchParams({ match: resolved.data.matchId });
  if (resolved.data.password !== '') {
    query.set('key', resolved.data.password);
  }
  return <Navigate to={`/games/pong?${query.toString()}`} replace />;
}
