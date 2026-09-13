import { useCallback, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { VoiceRoom } from '../features/voice/voice-room';
import { GameArt } from '../components/game-art';
import { GameActions } from '../features/catalog/game-actions';
import { GAMES } from '../features/catalog/games';
import { GameStage } from '../features/game/game-stage';
import { InvitePanel } from '../features/game/invite-panel';
import { RecordPanel } from '../features/stats/record-panel';
import { useSession } from '../session/use-session';

export function GameLobbyRoute() {
  const { gameId } = useParams();
  const [searchParams] = useSearchParams();
  const [joinedMatchId, setJoinedMatchId] = useState<string | null>(null);
  const onJoined = useCallback((id: string) => setJoinedMatchId(id), []);
  const { state } = useSession();
  const game = GAMES.find((candidate) => candidate.id === gameId);
  if (!game)
    return (
      <section className="panel">
        <p className="eyebrow">GAME NOT FOUND</p>
        <h1>This playground is missing.</h1>
        <p className="lede">Pick another game and get back into the action.</p>
        <Link className="button" to="/">
          Back to games →
        </Link>
      </section>
    );
  const matchId = searchParams.get('match');
  const next = `/games/${game.id}${searchParams.size ? `?${searchParams.toString()}` : ''}`;
  return (
    <section className={`panel panel--wide${matchId !== null ? ' match-page' : ''}`}>
      {matchId !== null ? (
        <header className="match-heading">
          <div>
            <p className="eyebrow">{game.label}</p>
            <h1>{game.name}</h1>
          </div>
          <Link className="text-link" to="/guide">
            Rules & controls ↗
          </Link>
        </header>
      ) : (
        <div className="game-detail">
          <div>
            <p className="eyebrow">{game.label}</p>
            <h1>{game.name}</h1>
            <p>{game.description}</p>
            <dl className="facts">
              <div>
                <dt>Players</dt>
                <dd>2</dd>
              </div>
              <div>
                <dt>Round</dt>
                <dd>{game.duration}</dd>
              </div>
            </dl>
            <Link className="text-link" to="/guide">
              Rules & controls ↗
            </Link>
          </div>
          <div className="game-detail__art">
            <GameArt game={game.id} />
          </div>
        </div>
      )}
      {state.status === 'signed-in' ? (
        matchId === null ? (
          <div className="lobby-options">
            <h2>Your next rivalry starts here.</h2>
            <p className="hint">Find an open match or create a lobby for a friend.</p>
            <GameActions gameId={game.id} />
          </div>
        ) : (
          <GameStage
            key={`${game.id}:${matchId}`}
            gameId={game.id}
            userId={state.profile.userId}
            matchId={matchId}
            password={searchParams.get('key') ?? undefined}
            onJoined={onJoined}
          />
        )
      ) : (
        <div className="lobby-options">
          <h2>Bring a little competition.</h2>
          <p className="hint">Join as a guest to play online. No email required.</p>
          <div className="actions">
            <Link className="button button--primary" to={`/login?next=${encodeURIComponent(next)}`}>
              Play online ↗
            </Link>
            {game.practice && (
              <Link className="button" to={`/practice/${game.id}`}>
                Try solo practice →
              </Link>
            )}
          </div>
        </div>
      )}
      {state.status === 'signed-in' && joinedMatchId !== null && joinedMatchId === matchId && (
        <>
          <InvitePanel matchId={joinedMatchId} />
          <VoiceRoom key={joinedMatchId} matchId={joinedMatchId} />
        </>
      )}
      {state.status === 'signed-in' && (
        <>
          <RecordPanel gameId={game.id} />
          {game.practice && (
            <Link className="text-link" to={`/practice/${game.id}`}>
              Warm up in solo practice →
            </Link>
          )}
        </>
      )}
      <div>
        <Link className="link-button" to="/">
          ← All games
        </Link>
      </div>
    </section>
  );
}
