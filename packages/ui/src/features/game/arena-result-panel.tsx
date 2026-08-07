import { Link } from 'react-router';
import type { ReactNode } from 'react';

/**
 * The panel over the arena once the match is decided.
 *
 * The same shape as the ready panel, over the same blurred arena, because it is
 * the same moment from the other end: the round is over and nobody is shooting.
 * It says the score rather than only the result — losing seven to six and losing
 * seven to nothing are not the same evening.
 */
export function ArenaResultPanel({
  won,
  ownScore,
  opponentScore,
  opponentName,
}: {
  readonly won: boolean;
  readonly ownScore: number;
  readonly opponentScore: number;
  readonly opponentName: string;
}): ReactNode {
  return (
    <div className="arena-panel" role="dialog" aria-label="Match result">
      <div className="arena-panel__card">
        <h2 className="arena-panel__title">{won ? 'You win' : `${opponentName} wins`}</h2>
        <p className="arena-result__score">
          <strong>{ownScore}</strong>
          <span> – </span>
          <strong>{opponentScore}</strong>
        </p>
        <div className="arena-panel__actions">
          <Link className="button button--primary" to="/">
            Back to the games
          </Link>
        </div>
        <p className="arena-panel__hint">
          The lobby closes on its own shortly. Open another from the game list to play again.
        </p>
      </div>
    </div>
  );
}
