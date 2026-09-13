import { BALL_RADIUS, FIELD_HEIGHT, RIGHT_PADDLE_X, type PongState } from '@littlegames/pong-logic';
import { cellsOf, type MarkedShot, type Shot } from '@littlegames/battleship-logic';
import type { PracticeDifficulty } from './difficulty';

/** Reflect the projected intercept at both walls, including multiple bounces. */
export function pongIntercept(ball: PongState['ball']): number {
  if (ball.vx <= 0) return FIELD_HEIGHT / 2;
  const travel = Math.max(0, (RIGHT_PADDLE_X - ball.x) / ball.vx);
  const span = FIELD_HEIGHT - BALL_RADIUS * 2;
  const projected = ball.y - BALL_RADIUS + ball.vy * travel;
  const folded = ((projected % (span * 2)) + span * 2) % (span * 2);
  return BALL_RADIUS + (folded <= span ? folded : span * 2 - folded);
}

/** The bot receives only public shot results; hidden ship positions are absent. */
export function chooseFleetShot(
  shots: readonly MarkedShot[],
  difficulty: PracticeDifficulty,
  random: () => number = Math.random,
): Shot | null {
  const seen = new Map(shots.map((shot) => [shot.row * 10 + shot.column, shot.result]));
  const available = Array.from({ length: 100 }, (_, cell) => cell).filter(
    (cell) => !seen.has(cell),
  );
  if (!available.length) return null;
  const pick = (candidates: readonly number[]) => {
    const cell =
      candidates[
        Math.min(candidates.length - 1, Math.floor(Math.max(0, random()) * candidates.length))
      ] ??
      available[0] ??
      0;
    return { row: Math.floor(cell / 10), column: cell % 10 };
  };
  if (difficulty === 'easy') return pick(available);
  // A sink ends the current pursuit. No ship identity or hidden coordinates
  // are supplied, so old hits remain observations rather than secret knowledge.
  const lastSink = shots.findLastIndex((shot) => shot.result === 'sunk');
  const hits = shots
    .slice(lastSink + 1)
    .filter((shot) => shot.result === 'hit')
    .map((shot) => shot.row * 10 + shot.column);
  const neighbors = available.filter((cell) =>
    hits.some(
      (hit) =>
        Math.abs(Math.floor(cell / 10) - Math.floor(hit / 10)) +
          Math.abs((cell % 10) - (hit % 10)) ===
        1,
    ),
  );
  if (difficulty === 'hard') {
    if (neighbors.length) return pick(neighbors);
    const parity = available.filter((cell) => (Math.floor(cell / 10) + (cell % 10)) % 2 === 0);
    return pick(parity.length ? parity : available);
  }
  const scores = new Map(available.map((cell) => [cell, 0]));
  for (const length of [5, 4, 3, 3, 2]) {
    for (const orientation of ['horizontal', 'vertical'] as const) {
      for (let row = 0; row < 10; row++)
        for (let column = 0; column < 10; column++) {
          const cells = cellsOf({ row, column, orientation }, length);
          if (cells.some((cell) => cell.row >= 10 || cell.column >= 10)) continue;
          const keys = cells.map((cell) => cell.row * 10 + cell.column);
          if (keys.some((cell) => seen.get(cell) === 'miss' || seen.get(cell) === 'sunk')) continue;
          const covered = hits.filter((hit) => keys.includes(hit)).length;
          if (hits.length && covered === 0) continue;
          const weight = hits.length ? 100 ** covered : 1;
          for (const cell of keys)
            if (scores.has(cell)) scores.set(cell, (scores.get(cell) ?? 0) + weight);
        }
    }
  }
  const best = Math.max(...scores.values());
  return pick(available.filter((cell) => scores.get(cell) === best));
}
