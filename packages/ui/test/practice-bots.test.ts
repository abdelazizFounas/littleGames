import { describe, expect, it } from 'vitest';
import {
  createInitialState as createPong,
  BALL_RADIUS,
  FIELD_HEIGHT,
} from '@littlegames/pong-logic';
import { cellsOf, randomFleet, shipLength, type MarkedShot } from '@littlegames/battleship-logic';
import { chooseFleetShot, pongIntercept } from '../src/features/practice/practice-bots';
import {
  createFleetRound,
  deployPracticeFleet,
  firePracticeShot,
  practiceFleetView,
} from '../src/features/practice/fleet-practice-state';
import { DIFFICULTIES, practiceDifficulty } from '../src/features/practice/difficulty';
function generator(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('practice opponents', () => {
  it('projects Pong returns through multiple wall bounces', () => {
    const ball = { ...createPong().ball, x: 100, y: 100, vx: 100, vy: 300 };
    const target = pongIntercept(ball);
    expect(target).toBeGreaterThanOrEqual(BALL_RADIUS);
    expect(target).toBeLessThanOrEqual(FIELD_HEIGHT - BALL_RADIUS);
    expect(target).not.toBe(ball.y);
    expect(pongIntercept({ ...ball, vx: -100 })).toBe(FIELD_HEIGHT / 2);
  });
  it('extra hard follows the axis of a discovered ship', () => {
    const observed: MarkedShot[] = [
      { row: 4, column: 4, result: 'hit' },
      { row: 4, column: 5, result: 'hit' },
    ];
    const shot = chooseFleetShot(observed, 'extra-hard', () => 0.5);
    if (!shot) throw new Error('No target found');
    expect(shot.row).toBe(4);
    expect([3, 6]).toContain(shot.column);
  });
  it.each(DIFFICULTIES)('%s never fires twice and exhausts every unknown cell', (difficulty) => {
    const observed: MarkedShot[] = [];
    const random = generator(42);
    for (let count = 0; count < 100; count++) {
      const shot = chooseFleetShot(observed, difficulty, random);
      if (!shot) throw new Error('No target found');
      expect(shot).not.toBeNull();
      expect(observed.some((past) => past.row === shot.row && past.column === shot.column)).toBe(
        false,
      );
      observed.push({ ...shot, result: 'miss' });
    }
    expect(chooseFleetShot(observed, difficulty)).toBeNull();
  });
  it('completes a local game and hides the bot fleet from the UI', () => {
    let round = deployPracticeFleet(createFleetRound(generator(10)), randomFleet(generator(15)));
    expect(round.state.phase).toBe('playing');
    expect(practiceFleetView(round)).not.toHaveProperty('enemyFleet');
    expect(practiceFleetView(round).yourFleet).toEqual(round.state.boards.a.fleet);
    const targets = round.state.boards.b.fleet.flatMap((ship, index) =>
      cellsOf(ship, shipLength(index)),
    );
    for (const shot of targets) round = firePracticeShot(round, 'a', shot);
    expect(round.state.winner).toBe('a');
    expect(practiceFleetView(round).opponentShipsSunk).toBe(5);
    expect(practiceFleetView(round).youWon).toBe(true);
    expect(round.outgoing).toHaveLength(17);
    expect(firePracticeShot(round, 'a', { row: 9, column: 9 })).toBe(round);
  });
  it('a miss passes the turn and out-of-turn shots do not change the game', () => {
    let round = deployPracticeFleet(createFleetRound(generator(10)), randomFleet(generator(15)));
    const occupied = new Set(
      round.state.boards.b.fleet.flatMap((ship, index) =>
        cellsOf(ship, shipLength(index)).map((cell) => cell.row * 10 + cell.column),
      ),
    );
    const cell = Array.from({ length: 100 }, (_, index) => index).find(
      (index) => !occupied.has(index),
    );
    if (cell === undefined) throw new Error('No empty water found');
    round = firePracticeShot(round, 'a', { row: Math.floor(cell / 10), column: cell % 10 });
    expect(round.state.turn).toBe('b');
    expect(firePracticeShot(round, 'a', { row: 0, column: 0 })).toBe(round);
  });
  it('uses Easy for unknown difficulty values', () => {
    expect(practiceDifficulty('impossible')).toBe('easy');
  });
});

it('stronger Fleet bots find the same hidden fleets in fewer shots', () => {
  const totals = { easy: 0, hard: 0, 'extra-hard': 0 };
  for (let seed = 1; seed <= 24; seed++) {
    for (const difficulty of DIFFICULTIES) {
      let round = deployPracticeFleet(
        createFleetRound(generator(seed)),
        randomFleet(generator(seed + 100)),
      );
      const random = generator(seed + 200);
      // Measure search efficiency independently of an opponent's turn speed.
      while (round.state.phase !== 'finished') {
        const shot = chooseFleetShot(round.outgoing, difficulty, random);
        if (!shot) throw new Error('Bot exhausted the board without finishing');
        round = firePracticeShot({ ...round, state: { ...round.state, turn: 'a' } }, 'a', shot);
      }
      totals[difficulty] += round.outgoing.length;
    }
  }
  expect(totals.hard).toBeLessThan(totals.easy);
  expect(totals['extra-hard']).toBeLessThan(totals.hard);
});
