// Regenerates the conformance vectors both implementations are checked against.
//
// The rules exist twice: here in TypeScript, and in Go on the authoritative
// server. Two implementations of the same rules drift, and a drift between
// client prediction and server truth shows up in first person as the camera
// being yanked. These vectors are the contract that catches it: TypeScript is
// the reference and writes them, Go replays them and must land on the same
// numbers.
//
// Run with `pnpm --filter @littlegames/arena-logic vectors` after any change to
// the rules, and read the diff before committing — a change here is a change to
// how the game plays.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARENA_BOXES, SPAWNS } from '../src/arena.ts';
import { eyePosition } from '../src/body.ts';
import {
  AIM_SCALE,
  COUNTDOWN_TICKS,
  MAX_REWIND_TICKS,
  MOVE_SCALE,
  RESPAWN_TICKS,
  STAND_HEIGHT,
  TICK_RATE,
} from '../src/constants.ts';
import {
  createInitialState,
  historyAt,
  startCountdown,
  type ArenaInput,
  type ArenaState,
} from '../src/state.ts';
import { step, type ShotEvent } from '../src/step.ts';
import { aimToWire, moveToWire, normalizeAim, type Vec3 } from '../src/vector.ts';

const CHECKPOINT_EVERY = 30;

/** Bits packed into one number, so a tick of input is seven integers. */
const FLAG_JUMP = 1;
const FLAG_CROUCH = 2;
const FLAG_FIRE = 4;

/**
 * One player's tick of input, as the integers that travel on the wire.
 *
 * Stored quantised rather than as the floats they came from, which is the same
 * discipline the client follows when it predicts. It also means the file cannot
 * encode a value the protocol has no way to carry.
 */
type WireInput = readonly [
  moveX: number,
  moveZ: number,
  aimX: number,
  aimY: number,
  aimZ: number,
  flags: number,
  rewindTicks: number,
];

function wire(
  move: { x: number; z: number },
  aim: Vec3,
  over: { jump?: boolean; crouch?: boolean; fire?: boolean; rewindTicks?: number } = {},
): WireInput {
  const quantisedMove = moveToWire(move);
  const quantisedAim = aimToWire(normalizeAim(aim));
  const flags =
    (over.jump === true ? FLAG_JUMP : 0) |
    (over.crouch === true ? FLAG_CROUCH : 0) |
    (over.fire === true ? FLAG_FIRE : 0);
  return [
    quantisedMove.x,
    quantisedMove.z,
    quantisedAim.x,
    quantisedAim.y,
    quantisedAim.z,
    flags,
    over.rewindTicks ?? 0,
  ];
}

/** The wire integers back to the shape `step` takes. Exactly as the server does. */
function decode(input: WireInput): ArenaInput {
  const [moveX, moveZ, aimX, aimY, aimZ, flags, rewindTicks] = input;
  return {
    move: { x: moveX / MOVE_SCALE, z: moveZ / MOVE_SCALE },
    aim: normalizeAim({ x: aimX / AIM_SCALE, y: aimY / AIM_SCALE, z: aimZ / AIM_SCALE }),
    jump: (flags & FLAG_JUMP) !== 0,
    crouch: (flags & FLAG_CROUCH) !== 0,
    fire: (flags & FLAG_FIRE) !== 0,
    rewindTicks,
  };
}

/**
 * The part of the state a checkpoint records.
 *
 * The history ring is deliberately left out. It is fifteen frames of two bodies
 * and would multiply the file by an order of magnitude, and it is already
 * pinned where it matters: the `duel` scenario resolves its shots through the
 * ring, so a ring indexed differently produces different hits and the recorded
 * shot events stop matching.
 */
function observable(state: ArenaState) {
  const player = (which: 'north' | 'south') => {
    const from = state[which];
    return {
      body: from.body,
      aim: from.aim,
      alive: from.alive,
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

interface Scenario {
  readonly name: string;
  readonly description: string;
  /** North's seven integers followed by south's, one row per tick. */
  readonly inputs: number[][];
  readonly checkpoints: { tick: number; state: ReturnType<typeof observable> }[];
  readonly shots: { tick: number; shots: readonly ShotEvent[] }[];
}

/**
 * Plays a scenario out and records it.
 *
 * `plan` is asked for each tick's inputs and may read the state, which is what
 * lets a scenario aim at where the other player actually is rather than at a
 * position written down in advance.
 */
function record(
  name: string,
  description: string,
  ticks: number,
  plan: (tick: number, state: ArenaState) => { north: WireInput; south: WireInput },
): Scenario {
  let state = startCountdown(createInitialState(), COUNTDOWN_TICKS);
  const inputs: number[][] = [];
  const checkpoints: Scenario['checkpoints'] = [{ tick: 0, state: observable(state) }];
  const shots: Scenario['shots'] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    const wired = plan(tick, state);
    inputs.push([...wired.north, ...wired.south]);
    const result = step(state, { north: decode(wired.north), south: decode(wired.south) });
    state = result.state;
    // Shots are sparse and they are the part most worth pinning, so every one
    // is recorded rather than only those landing on a checkpoint.
    if (result.shots.length > 0) {
      shots.push({ tick: tick + 1, shots: result.shots });
    }
    if ((tick + 1) % CHECKPOINT_EVERY === 0 || tick === ticks - 1) {
      checkpoints.push({ tick: tick + 1, state: observable(state) });
    }
  }

  return { name, description, inputs, checkpoints, shots };
}

const FORWARD: Vec3 = { x: 0, y: 0, z: -1 };
const BACKWARD: Vec3 = { x: 0, y: 0, z: 1 };

/** Aim from one player's eyes at the middle of the other's body. */
function aimAcross(state: ArenaState, from: 'north' | 'south'): Vec3 {
  const shooter = from === 'north' ? state.north : state.south;
  const target = from === 'north' ? state.south : state.north;
  const eye = eyePosition(shooter.body);
  return normalizeAim({
    x: target.body.x - eye.x,
    y: target.body.y + STAND_HEIGHT / 2 - eye.y,
    z: target.body.z - eye.z,
  });
}

const scenarios: Scenario[] = [
  record(
    'strafe',
    'Both players circle their cover without firing. Pins plain movement, the speed cap and the countdown.',
    600,
    (tick) => {
      const phase = Math.sin(tick / 24);
      return {
        north: wire({ x: phase, z: Math.cos(tick / 31) * 0.5 }, BACKWARD),
        south: wire({ x: -phase, z: Math.cos(tick / 19) * 0.5 }, FORWARD),
      };
    },
  ),

  record(
    'crateHug',
    'Walks a body into every face and every inside corner it can reach, so the resolution order is pinned rather than assumed.',
    900,
    (tick) => {
      // Eight directions in turn, long enough on each to arrive at something
      // and press into it.
      const leg = Math.floor(tick / 110) % 8;
      const angle = (leg * 2 * Math.PI) / 8;
      const move = { x: Math.cos(angle), z: Math.sin(angle) };
      return {
        north: wire(move, BACKWARD),
        south: wire({ x: -move.x, z: -move.z }, FORWARD),
      };
    },
  ),

  record(
    'verticality',
    'Jumping onto crates and crouching under the awning, which is where gravity, landing and the standing check all meet.',
    900,
    (tick) => {
      const jumping = tick % 45 < 3;
      const crouching = tick % 180 > 120;
      return {
        north: wire({ x: 0, z: -0.6 }, BACKWARD, { jump: jumping, crouch: crouching }),
        south: wire({ x: 0.4, z: 0.6 }, FORWARD, { jump: jumping, crouch: !crouching }),
      };
    },
  ),

  record(
    'duel',
    'Peek and shoot with a real rewind, so lag compensation and the history ring are pinned along with the ray.',
    900,
    (tick, state) => {
      const back = MAX_REWIND_TICKS - 4;
      const seen = historyAt(state, back);
      const southEye = eyePosition(state.south.body);
      // South aims at where north *was*, which is the whole point of the
      // rewind: a ring indexed differently changes what this shot hits.
      const laggedAim = normalizeAim({
        x: seen.north.x - southEye.x,
        y: seen.north.y + STAND_HEIGHT / 2 - southEye.y,
        z: seen.north.z - southEye.z,
      });
      return {
        north: wire({ x: Math.sin(tick / 18), z: 0 }, aimAcross(state, 'north'), {
          fire: tick % 90 === 40,
        }),
        south: wire({ x: 0, z: 0 }, laggedAim, { fire: tick % 60 === 20, rewindTicks: back }),
      };
    },
  ),

  record(
    'traded',
    'Both players fire on the same tick and both connect, so neither seat can be given a free trade by being resolved first.',
    // Long enough to trade several times over. Firing during the countdown is
    // refused, so a scenario shorter than it would record almost nothing.
    COUNTDOWN_TICKS + 480,
    (tick, state) => {
      const together = tick > COUNTDOWN_TICKS && (tick - COUNTDOWN_TICKS) % 120 === 10;
      return {
        north: wire({ x: 0, z: 0 }, aimAcross(state, 'north'), { fire: together }),
        south: wire({ x: 0, z: 0 }, aimAcross(state, 'south'), { fire: together }),
      };
    },
  ),

  record(
    'match',
    'Played all the way to the winning score, so scoring, respawning and the end of a match are all covered.',
    COUNTDOWN_TICKS + (RESPAWN_TICKS + 30) * 9,
    (_tick, state) => ({
      north: wire({ x: 0, z: 0 }, aimAcross(state, 'north')),
      south: wire({ x: 0, z: 0 }, aimAcross(state, 'south'), { fire: state.north.alive }),
    }),
  ),
];

const output = {
  generatedBy: 'packages/games/arena/logic/scripts/write-vectors.ts',
  tickRate: TICK_RATE,
  checkpointEvery: CHECKPOINT_EVERY,
  // The geometry travels with the vectors, and the Go test asserts its own copy
  // matches this one field by field. A crate nudged in one language and not the
  // other is otherwise a silent disagreement about where a wall is.
  arena: ARENA_BOXES,
  spawns: SPAWNS,
  scenarios,
};

const target = fileURLToPath(new URL('../testdata/vectors.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(output)}\n`);

for (const scenario of scenarios) {
  const last = scenario.checkpoints.at(-1)?.state;
  console.log(
    `${scenario.name.padEnd(12)} ${String(scenario.inputs.length).padStart(5)} ticks  ` +
      `${String(last?.phase).padEnd(10)} ${String(last?.north.score)}-${String(last?.south.score)}` +
      `  ${String(scenario.shots.length)} ticks with shots`,
  );
}
console.log(`\nwritten to ${target}`);
