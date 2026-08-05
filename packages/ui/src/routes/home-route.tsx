import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { SignInPanel } from '../features/auth/sign-in-panel';
import { GameList } from '../features/catalog/game-list';
import { useSession } from '../session/use-session';

export function HomeRoute(): ReactNode {
  const { state } = useSession();

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
      <p className="eyebrow">Games</p>
      <h1>Pick a game</h1>
      {state.profile.isGuest && (
        <p className="hint">
          You are playing as a guest. <Link to="/profile">Secure your account</Link> to keep it.
        </p>
      )}
      <GameList />
    </section>
  );
}
