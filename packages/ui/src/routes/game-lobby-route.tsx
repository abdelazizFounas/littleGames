import { useCallback, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { useCatalog } from '../features/catalog/use-catalog';
import { InvitePanel } from '../features/game/invite-panel';
import { PongStage } from '../features/game/pong-stage';
import { useSession } from '../session/use-session';

function Frame({ children }: { readonly children: ReactNode }): ReactNode {
  // Wider than the rest of the shell: the field wants room, and a 26rem column
  // would letterbox it down to a postage stamp.
  return <section className="panel panel--wide">{children}</section>;
}

export function GameLobbyRoute(): ReactNode {
  const { gameId } = useParams();
  const [searchParams] = useSearchParams();
  const [joinedMatchId, setJoinedMatchId] = useState<string | null>(null);
  const onJoined = useCallback((id: string) => {
    setJoinedMatchId(id);
  }, []);
  const { state } = useSession();
  const catalog = useCatalog();

  if (state.status === 'loading') {
    return (
      <Frame>
        <p className="lede">Loading…</p>
      </Frame>
    );
  }

  if (state.status === 'signed-out') {
    return <Navigate to="/" replace />;
  }

  if (catalog.status === 'loading') {
    return (
      <Frame>
        <p className="lede">Loading…</p>
      </Frame>
    );
  }

  if (catalog.status === 'failed') {
    return (
      <Frame>
        <p role="alert" className="error">
          {catalog.error}
        </p>
      </Frame>
    );
  }

  const game = catalog.data.find((candidate) => candidate.id === gameId);

  if (game === undefined) {
    // A stale bookmark or a mistyped id lands here. It has to say so rather
    // than render an empty screen.
    return (
      <Frame>
        <p className="eyebrow">Unknown game</p>
        <h1>We could not find that game</h1>
        <p className="hint">It may have been renamed or removed from the catalogue.</p>
        <Link className="button" to="/">
          Back to the games
        </Link>
      </Frame>
    );
  }

  return (
    <Frame>
      <p className="eyebrow">{game.tagline}</p>
      <h1>{game.name}</h1>
      <p className="hint">{game.description}</p>
      <dl className="facts">
        <div>
          <dt>Players</dt>
          <dd>
            {game.minPlayers === game.maxPlayers
              ? game.minPlayers
              : `${String(game.minPlayers)}–${String(game.maxPlayers)}`}
          </dd>
        </div>
      </dl>

      <PongStage
        userId={state.profile.userId}
        matchId={searchParams.get('match') ?? undefined}
        onJoined={onJoined}
      />

      <InvitePanel matchId={joinedMatchId} />

      <Link className="link-button" to="/">
        Back to the games
      </Link>
    </Frame>
  );
}
