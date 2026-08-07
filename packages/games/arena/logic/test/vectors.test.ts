import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARENA_BOXES, SPAWNS } from '../src/arena.ts';
import { AIM_SCALE, COUNTDOWN_TICKS, MOVE_SCALE, TICK_RATE } from '../src/constants.ts';
import { createInitialState, startCountdown, type ArenaInput, type ArenaState } from '../src/state.ts';
import { step, type ShotEvent } from '../src/step.ts';
import { normalizeAim } from '../src/vector.ts';

/**
 * Replays the conformance vectors.
 *
 * This is half of a contract. The other half is
 * `server/nakama/arena/vectors_test.go`, which reads the very same file — not a
 * copy of it — and must arrive at the same numbers. If either side of that
 * stops holding, client prediction and server truth have parted company, and in
 * first person that is felt as the camera being pulled out from under you.
 */

const FLAG_JUMP = 1;
const FLAG_CROUCH = 2;
const FLAG_FIRE = 4;
const FLAG_ZOOM = 8;

interface Vectors {
  readonly tickRate: number;
  readonly checkpointEvery: number;
  readonly arena: typeof ARENA_BOXES;
  readonly spawns: typeof SPAWNS;
  readonly scenarios: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputs: readonly number[][];
    readonly checkpoints: readonly { readonly tick: number; readonly state: unknown }[];
    readonly shots: readonly { readonly tick: number; readonly shots: readonly ShotEvent[] }[];
  }[];
}

// Reading a fixture the sibling generator wrote. The Go conformance test
// decodes the same file into its own structs; this is the TypeScript half of
// that same trust.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('../testdata/vectors.json', import.meta.url)), 'utf8'),
) as Vectors;

/** The same subset of the state the generator recorded. */
function observable(state: ArenaState): unknown {
  const player = (which: 'north' | 'south') => {
    const from = state[which];
    return {
      body: from.body,
      aim: from.aim,
      alive: from.alive,
      health: from.health,
      score: from.score,
      respawnTicks: from.respawnTicks,
      spawnEpoch: from.spawnEpoch,
      cooldownTicks: from.cooldownTicks,
    };
  };
  return {
    phase: state.phase,
    phaseTicks: state.phaseTicks,
    tick: state.tick,
    north: player('north'),
    south: player('south'),
    winner: state.winner,
    nextShotId: state.nextShotId,
  };
}

function decode(row: readonly number[], offset: number): ArenaInput {
  const flags = row[offset + 5] ?? 0;
  return {
    move: { x: (row[offset] ?? 0) / MOVE_SCALE, z: (row[offset + 1] ?? 0) / MOVE_SCALE },
    aim: normalizeAim({
      x: (row[offset + 2] ?? 0) / AIM_SCALE,
      y: (row[offset + 3] ?? 0) / AIM_SCALE,
      z: (row[offset + 4] ?? 0) / AIM_SCALE,
    }),
    jump: (flags & FLAG_JUMP) !== 0,
    crouch: (flags & FLAG_CROUCH) !== 0,
    fire: (flags & FLAG_FIRE) !== 0,
    zoomed: (flags & FLAG_ZOOM) !== 0,
    rewindTicks: row[offset + 6] ?? 0,
  };
}

describe('conformance vectors', () => {
  it('were generated at this tick rate', () => {
    // Changing the tick rate changes every number in the file, which is a
    // feature: it forces the vectors to be regenerated and read.
    expect(vectors.tickRate).toBe(TICK_RATE);
  });

  it('carry the arena the rules are compiled against', () => {
    // The Go port asserts the same thing against its own copy. Between the two
    // assertions, a crate cannot be nudged in one language alone.
    expect(vectors.arena).toEqual(ARENA_BOXES);
    expect(vectors.spawns).toEqual(SPAWNS);
  });

  it.each(vectors.scenarios.map((scenario) => [scenario.name, scenario] as const))(
    'replays "%s" exactly',
    (_name, scenario) => {
      let state = startCountdown(createInitialState(), COUNTDOWN_TICKS);
      expect(observable(state)).toEqual(scenario.checkpoints[0]?.state);

      const checkpoints = new Map(scenario.checkpoints.map((entry) => [entry.tick, entry.state]));
      const shotsByTick = new Map(scenario.shots.map((entry) => [entry.tick, entry.shots]));

      for (const [index, row] of scenario.inputs.entries()) {
        const result = step(state, { north: decode(row, 0), south: decode(row, 7) });
        state = result.state;
        const tick = index + 1;

        const expectedShots = shotsByTick.get(tick) ?? [];
        expect(result.shots).toEqual(expectedShots);

        const expected = checkpoints.get(tick);
        if (expected !== undefined) {
          expect(observable(state)).toEqual(expected);
        }
      }
    },
  );

  it('cover a match played to the end', () => {
    // A guard against the vectors quietly shrinking to something that never
    // reaches a score, a respawn or a winner.
    const finished = vectors.scenarios.some((scenario) => {
      const last = scenario.checkpoints.at(-1)?.state;
      if (typeof last !== 'object' || last === null) {
        return false;
      }
      const record: Record<string, unknown> = { ...last };
      return record['phase'] === 'finished' && typeof record['winner'] === 'string';
    });
    const shooting = vectors.scenarios.filter((scenario) => scenario.shots.length > 0);

    expect(finished).toBe(true);
    expect(shooting.length).toBeGreaterThanOrEqual(3);
  });
});
