import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAsyncData } from '../../lib/use-async-data';
import { useSession } from '../../session/use-session';

/**
 * The games this player walked away from, offered before the catalogue.
 *
 * Above the list of games on purpose: a match already under way is more urgent
 * than starting another, and an opponent is waiting in it.
 */
export function ResumePanel(): ReactNode {
  const { listMyMatches } = useSession();
  const navigate = useNavigate();
  const mine = useAsyncData(listMyMatches, 'Could not check your games.');

  // Nothing to resume is the ordinary case, and deserves no space at all.
  if (mine.status !== 'ready' || mine.data.length === 0) {
    return null;
  }

  return (
    <section className="resume">
      <p className="eyebrow">In progress</p>
      <ul className="lobby-list">
        {mine.data.map((entry) => (
          <li key={entry.matchId}>
            <span className="lobby-list__host">
              {entry.game} — {entry.host}&apos;s game
            </span>
            <span className="lobby-list__meta">
              {entry.players} {entry.players === 1 ? 'player' : 'players'}
            </span>
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                const query = new URLSearchParams({ match: entry.matchId });
                if (entry.password !== '') {
                  // Already admitted once; asking again would be theatre.
                  query.set('key', entry.password);
                }
                void navigate(`/games/${entry.game}?${query.toString()}`);
              }}
            >
              Resume
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
