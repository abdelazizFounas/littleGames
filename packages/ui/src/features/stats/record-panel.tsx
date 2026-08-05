import { useCallback, type ReactNode } from 'react';
import { useAsyncData } from '../../lib/use-async-data';
import { useSession } from '../../session/use-session';

/** Wins as a percentage, or a dash when nothing has been played. */
function winRate(played: number, won: number): string {
  return played === 0 ? '—' : `${String(Math.round((won / played) * 100))}%`;
}

export function RecordPanel({ gameId }: { readonly gameId: string }): ReactNode {
  const { loadStats, loadLeaderboard } = useSession();
  // Wrapped rather than written inline: useAsyncData reloads whenever its
  // loader changes identity, and a fresh arrow function on every render means
  // every render triggers another load, which triggers another render.
  const load = useCallback(() => loadStats(gameId), [gameId, loadStats]);
  const stats = useAsyncData(load, 'Could not load your record.');
  const loadBoard = useCallback(() => loadLeaderboard(gameId), [gameId, loadLeaderboard]);
  const board = useAsyncData(loadBoard, 'Could not load the board.');

  return (
    <section className="form">
      <h2>Your record</h2>
      {stats.status === 'loading' && <p className="hint">Loading…</p>}
      {stats.status === 'failed' && (
        <p role="alert" className="error">
          {stats.error}
        </p>
      )}
      {stats.status === 'ready' && (
        <dl className="facts facts--grid">
          <div>
            <dt>Played</dt>
            <dd>{stats.data.played}</dd>
          </div>
          <div>
            <dt>Won</dt>
            <dd>{stats.data.won}</dd>
          </div>
          <div>
            <dt>Lost</dt>
            <dd>{stats.data.lost}</dd>
          </div>
          <div>
            <dt>Win rate</dt>
            <dd>{winRate(stats.data.played, stats.data.won)}</dd>
          </div>
          <div>
            <dt>Points</dt>
            <dd>
              {stats.data.pointsFor}–{stats.data.pointsAgainst}
            </dd>
          </div>
        </dl>
      )}

      <h2>This week</h2>
      <p className="hint">Wins, counted from Monday. The board resets every week.</p>
      {board.status === 'loading' && <p className="hint">Loading…</p>}
      {board.status === 'failed' && (
        <p role="alert" className="error">
          {board.error}
        </p>
      )}
      {board.status === 'ready' &&
        (board.data.length === 0 ? (
          <p className="hint">Nobody has won a match yet this week.</p>
        ) : (
          <ol className="board">
            {board.data.map((entry) => (
              <li key={`${String(entry.rank)}-${entry.username}`} className={entry.isSelf ? 'board__self' : undefined}>
                <span className="board__rank">{entry.rank}</span>
                <span className="board__name">{entry.username}</span>
                <span className="board__wins">{entry.wins}</span>
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
