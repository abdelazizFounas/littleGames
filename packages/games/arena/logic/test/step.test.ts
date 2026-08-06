import { describe, expect, it } from 'vitest';
import { SPAWNS } from '../src/arena.ts';
import { eyePosition } from '../src/body.ts';
import {
  COUNTDOWN_TICKS,
  FIRE_COOLDOWN_TICKS,
  MOVE_SPEED,
  RESPAWN_TICKS,
  STAND_HEIGHT,
  TICK_SECONDS,
  WINNING_SCORE,
} from '../src/constants.ts';
import {
  NO_INPUT,
  clampRewind,
  createInitialState,
  historyAt,
  startCountdown,
  type ArenaInput,
  type ArenaState,
} from '../src/state.ts';
import { step } from '../src/step.ts';
import { normalizeAim, type Vec3 } from '../src/vector.ts';

const input = (over: Partial<ArenaInput> = {}): ArenaInput => ({ ...NO_INPUT, ...over });
const IDLE = { north: NO_INPUT, south: NO_INPUT };

/** Both players standing at their spawns, with the round already open. */
function playing(): ArenaState {
  let state = startCountdown(createInitialState(), COUNTDOWN_TICKS);
  for (let tick = 0; tick <= COUNTDOWN_TICKS; tick += 1) {
    state = step(state, IDLE).state;
  }
  return state;
}

function aimAt(from: Vec3, to: Vec3): Vec3 {
  return normalizeAim({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
}

/** The middle of a body, which is what a shot is pointed at. */
function chestOf(body: { x: number; y: number; z: number }): Vec3 {
  return { x: body.x, y: body.y + STAND_HEIGHT / 2, z: body.z };
}

function advance(state: ArenaState, ticks: number, inputs = IDLE): ArenaState {
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) {
    current = step(current, inputs).state;
  }
  return current;
}

describe('phases', () => {
  it('does nothing at all until the round is opened', () => {
    const waiting = createInitialState();

    expect(step(waiting, IDLE).state).toBe(waiting);
  });

  it('counts down, letting both players take position, then opens play', () => {
    let state = startCountdown(createInitialState(), COUNTDOWN_TICKS);
    expect(state.phase).toBe('countdown');

    const walking = { north: input({ move: { x: 1, z: 0 } }), south: NO_INPUT };
    state = advance(state, 10, walking);
    expect(state.phase).toBe('countdown');
    expect(state.north.body.x).toBeGreaterThan(SPAWNS.north.x);

    state = advance(state, COUNTDOWN_TICKS, walking);
    expect(state.phase).toBe('playing');
  });

  it('refuses to fire during the countdown', () => {
    const state = startCountdown(createInitialState(), COUNTDOWN_TICKS);
    const eye = eyePosition(state.south.body);
    const firing = {
      north: NO_INPUT,
      south: input({ fire: true, aim: aimAt(eye, chestOf(state.north.body)) }),
    };

    expect(step(state, firing).shots).toHaveLength(0);
  });

  it('stops once somebody has won', () => {
    const finished: ArenaState = { ...playing(), phase: 'finished', winner: 'north' };

    expect(step(finished, IDLE).state).toBe(finished);
  });
});

describe('the speed cap', () => {
  it('shortens a move a client claims is longer than a move can be', () => {
    const state = playing();

    const honest = step(state, { north: NO_INPUT, south: input({ move: { x: 1, z: 0 } }) }).state;
    const greedy = step(state, { north: NO_INPUT, south: input({ move: { x: 40, z: 0 } }) }).state;

    expect(greedy.south.body.x).toBeCloseTo(honest.south.body.x, 12);
    expect(greedy.south.body.x - state.south.body.x).toBeCloseTo(MOVE_SPEED * TICK_SECONDS, 12);
  });

  it('leaves a half-pushed stick at half speed', () => {
    const state = playing();

    const gentle = step(state, { north: NO_INPUT, south: input({ move: { x: 0.5, z: 0 } }) }).state;

    expect(gentle.south.body.x - state.south.body.x).toBeCloseTo(
      (MOVE_SPEED * TICK_SECONDS) / 2,
      12,
    );
  });
});

describe('shooting', () => {
  function southShootsNorth(state: ArenaState, over: Partial<ArenaInput> = {}) {
    const eye = eyePosition(state.south.body);
    return {
      north: NO_INPUT,
      south: input({ fire: true, aim: aimAt(eye, chestOf(state.north.body)), ...over }),
    };
  }

  it('kills across the gap, scores, and reports the shot', () => {
    const state = playing();

    const { state: after, shots } = step(state, southShootsNorth(state));

    expect(shots).toHaveLength(1);
    expect(shots[0]?.shooter).toBe('south');
    expect(shots[0]?.hitPlayer).toBe(true);
    expect(after.south.score).toBe(1);
    expect(after.north.alive).toBe(false);
  });

  it('reports a miss as a shot that hit nothing', () => {
    const state = playing();
    const eye = eyePosition(state.south.body);
    const wide = {
      north: NO_INPUT,
      south: input({ fire: true, aim: aimAt(eye, { x: 9, y: 5, z: state.north.body.z }) }),
    };

    const { state: after, shots } = step(state, wide);

    expect(shots).toHaveLength(1);
    expect(shots[0]?.hitPlayer).toBe(false);
    expect(after.south.score).toBe(0);
    expect(after.north.alive).toBe(true);
  });

  it('will not fire again until the cooldown has run out', () => {
    let state = playing();
    const firing = southShootsNorth(state);

    const first = step(state, firing);
    expect(first.shots).toHaveLength(1);
    state = first.state;

    // The target is dead, so nothing is hit; what is being counted is shots.
    let fired = 0;
    for (let tick = 0; tick < FIRE_COOLDOWN_TICKS - 1; tick += 1) {
      const result = step(state, firing);
      fired += result.shots.length;
      state = result.state;
    }
    expect(fired).toBe(0);

    expect(step(state, firing).shots).toHaveLength(1);
  });

  it('lets both players trade on the same tick', () => {
    // Resolved against the state before either shot landed. Applying one and
    // then the other would hand whichever seat is tested first a free win,
    // decided by nothing a player can see.
    const state = playing();
    const northEye = eyePosition(state.north.body);
    const southEye = eyePosition(state.south.body);

    const { state: after, shots } = step(state, {
      north: input({ fire: true, aim: aimAt(northEye, chestOf(state.south.body)) }),
      south: input({ fire: true, aim: aimAt(southEye, chestOf(state.north.body)) }),
    });

    expect(shots).toHaveLength(2);
    expect(after.north.alive).toBe(false);
    expect(after.south.alive).toBe(false);
    expect(after.north.score).toBe(1);
    expect(after.south.score).toBe(1);
  });

  it('cannot shoot a player who is already down', () => {
    let state = playing();
    state = step(state, southShootsNorth(state)).state;
    expect(state.north.alive).toBe(false);

    // Wait out the cooldown, then fire at the same place again.
    state = advance(state, FIRE_COOLDOWN_TICKS);
    const { state: after, shots } = step(state, southShootsNorth(state));

    expect(shots).toHaveLength(1);
    expect(shots[0]?.hitPlayer).toBe(false);
    expect(after.south.score).toBe(1);
  });
});

describe('respawning', () => {
  it('comes back at the spawn after a delay, keeping the score', () => {
    let state = playing();
    state = step(state, {
      north: NO_INPUT,
      south: input({
        fire: true,
        aim: aimAt(eyePosition(state.south.body), chestOf(state.north.body)),
      }),
    }).state;
    const epochBefore = state.north.spawnEpoch;

    state = advance(state, RESPAWN_TICKS - 2);
    expect(state.north.alive).toBe(false);

    state = advance(state, 2);
    expect(state.north.alive).toBe(true);
    expect(state.north.spawnEpoch).toBe(epochBefore + 1);
    expect(state.north.body.z).toBeCloseTo(SPAWNS.north.z, 9);
    expect(state.south.score).toBe(1);
  });
});

describe('lag compensation', () => {
  /** Walks the north player sideways for long enough to leave a trail. */
  function strafingNorth(): ArenaState {
    return advance(playing(), 20, {
      north: input({ move: { x: 1, z: 0 } }),
      south: NO_INPUT,
    });
  }

  it('hits where the shooter saw the target, not where it has got to', () => {
    const state = strafingNorth();
    const back = 15;
    const seen = historyAt(state, back).north;

    // Far enough away by now that aiming at the remembered position cannot
    // catch the current one by accident.
    expect(Math.abs(state.north.body.x - seen.x)).toBeGreaterThan(1);

    const eye = eyePosition(state.south.body);
    const aim = aimAt(eye, chestOf(seen));

    const compensated = step(state, {
      north: NO_INPUT,
      south: input({ fire: true, aim, rewindTicks: back }),
    });
    const uncompensated = step(state, {
      north: NO_INPUT,
      south: input({ fire: true, aim, rewindTicks: 0 }),
    });

    expect(compensated.shots[0]?.hitPlayer).toBe(true);
    expect(uncompensated.shots[0]?.hitPlayer).toBe(false);
  });

  it('refuses to rewind across a respawn', () => {
    // The ugliest death there is: killed a beat after reappearing, by a shot
    // aimed at where the corpse was.
    let state = playing();
    const moving = { north: input({ move: { x: 1, z: 0 } }), south: NO_INPUT };
    state = advance(state, 40, moving);
    const deathSpot = state.north.body;

    state = step(state, {
      north: NO_INPUT,
      south: input({ fire: true, aim: aimAt(eyePosition(state.south.body), chestOf(deathSpot)) }),
    }).state;
    expect(state.north.alive).toBe(false);

    state = advance(state, RESPAWN_TICKS);
    expect(state.north.alive).toBe(true);
    state = advance(state, 3);

    // A rewind that reaches back before the respawn is refused, so the shot is
    // judged against where the player is now — at their spawn, not here.
    const late = step(advance(state, FIRE_COOLDOWN_TICKS), {
      north: NO_INPUT,
      south: input({
        fire: true,
        aim: aimAt(eyePosition(state.south.body), chestOf(deathSpot)),
        rewindTicks: 12,
      }),
    });

    expect(late.shots[0]?.hitPlayer).toBe(false);
  });

  it('clamps a rewind a client asks for, at both ends', () => {
    // Claiming to have seen the future buys nothing...
    expect(clampRewind(200, 100)).toBe(clampRewind(100, 100));
    // ...and neither does claiming a tick older than anything remembered.
    expect(clampRewind(0, 100_000)).toBeLessThan(20);
    // Honest clients get the delay their screen actually carried.
    expect(clampRewind(95, 100)).toBeGreaterThan(clampRewind(99, 100));
  });
});

describe('winning', () => {
  it('ends the match at the winning score', () => {
    let state = playing();

    for (let round = 0; round < WINNING_SCORE; round += 1) {
      state = step(state, {
        north: NO_INPUT,
        south: input({
          fire: true,
          aim: aimAt(eyePosition(state.south.body), chestOf(state.north.body)),
        }),
      }).state;
      if (state.phase === 'finished') {
        break;
      }
      state = advance(state, RESPAWN_TICKS);
    }

    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('south');
    expect(state.south.score).toBe(WINNING_SCORE);
  });

  it('never mutates the state it was given', () => {
    const state = playing();
    const before = structuredClone(state);

    step(state, {
      north: input({ move: { x: 1, z: 0 }, jump: true }),
      south: input({ fire: true }),
    });

    expect(state).toEqual(before);
  });
});
