import { SEATS, opponentOf, type Seat } from './arena.ts';
import { eyePosition, stepBody } from './body.ts';
import {
  FIRE_COOLDOWN_TICKS,
  HEAD_DAMAGE,
  LIMB_DAMAGE,
  RESPAWN_TICKS,
  TORSO_DAMAGE,
  WINNING_SCORE,
} from './constants.ts';
import { hittablePartsOf, poseOf, type BodyPart } from './pose.ts';
import { traceShot, type ShotTarget } from './ray.ts';
import { deflect, seedOf, spreadOf } from './spread.ts';
import {
  historyAt,
  respawn,
  type ArenaInput,
  type ArenaInputs,
  type ArenaState,
  type HistoryFrame,
  type PlayerSim,
} from './state.ts';
import { clampToUnit, normalizeAim, type Vec3 } from './vector.ts';

/** A shot the server resolved, for the client to draw as a tracer. */
export interface ShotEvent {
  readonly id: number;
  readonly shooter: Seat;
  readonly origin: Vec3;
  readonly endpoint: Vec3;
  readonly hitPlayer: boolean;
}

export interface StepResult {
  readonly state: ArenaState;
  readonly shots: readonly ShotEvent[];
}

const NO_SHOTS: readonly ShotEvent[] = [];

function moved(player: PlayerSim, input: ArenaInput): PlayerSim {
  // Shortening the move to unit length is the speed cap, and it happens here
  // rather than in the caller so that it is part of the rules the vectors pin.
  // A dead player's intent is ignored entirely.
  if (!player.alive) {
    return player;
  }
  return {
    ...player,
    body: stepBody(player.body, {
      move: clampToUnit(input.move),
      jump: input.jump,
      crouch: input.crouch,
    }),
  };
}

function frameOf(north: PlayerSim, south: PlayerSim): HistoryFrame {
  return {
    north: north.body,
    south: south.body,
    northAim: north.aim,
    southAim: south.aim,
    northAlive: north.alive,
    southAlive: south.alive,
    northEpoch: north.spawnEpoch,
    southEpoch: south.spawnEpoch,
  };
}

/**
 * Every part of a target, where it was when the shooter saw it.
 *
 * Rewinding is refused across a respawn: if the target has been put back at
 * their spawn since the frame being read, the shot is judged against where they
 * are now. Without that, the ugliest death in the game is possible — being
 * killed a beat after reappearing, by a bullet aimed at the corpse.
 *
 * The aim comes out of the ring along with the body, because the parts are
 * oriented by it. Rewinding one and not the other would put a target's feet
 * where they were and their arms where they are.
 */
function rewoundParts(state: ArenaState, target: PlayerSim, seat: Seat, back: number): ShotTarget[] {
  const frame = historyAt(state, back);
  const epoch = seat === 'north' ? frame.northEpoch : frame.southEpoch;
  const current = epoch !== target.spawnEpoch;
  const body = current ? target.body : seat === 'north' ? frame.north : frame.south;
  const aim = current ? target.aim : seat === 'north' ? frame.northAim : frame.southAim;

  return hittablePartsOf(poseOf(body, aim)).map((part) => ({
    seat,
    part: part.part,
    box: part,
  }));
}

/** What one hit takes off, decided entirely by where it landed. */
export function damageOf(part: BodyPart): number {
  if (part === 'head') {
    return HEAD_DAMAGE;
  }
  return part === 'torso' ? TORSO_DAMAGE : LIMB_DAMAGE;
}

/**
 * Advances the simulation by exactly one tick.
 *
 * Pure: the same state and the same inputs always produce the same next state,
 * which is what lets the server, a client predicting ahead, and a test all
 * agree — and what lets the Go port be held to the same numbers.
 */
export function step(state: ArenaState, inputs: ArenaInputs): StepResult {
  if (state.phase === 'waiting' || state.phase === 'finished') {
    return { state, shots: NO_SHOTS };
  }

  // Aim is latched first and for both seats, whatever the phase: a player
  // turning during the countdown is looking where they will be looking when it
  // ends.
  let north: PlayerSim = { ...state.north, aim: normalizeAim(inputs.north.aim) };
  let south: PlayerSim = { ...state.south, aim: normalizeAim(inputs.south.aim) };

  // Bodies move during the countdown too, so a player can take position before
  // the round opens.
  north = moved(north, inputs.north);
  south = moved(south, inputs.south);

  // The ring records where they ended up, before anybody is shot. This is the
  // frame a shooter one tick from now will be rewound into.
  const length = state.history.length;
  const writeAt = (state.historyAt + 1) % length;
  const history = [...state.history];
  history[writeAt] = frameOf(north, south);

  const afterMove: ArenaState = { ...state, north, south, history, historyAt: writeAt };

  if (state.phase === 'countdown') {
    const phaseTicks = state.phaseTicks - 1;
    return {
      state: {
        ...afterMove,
        phase: phaseTicks > 0 ? 'countdown' : 'playing',
        phaseTicks: phaseTicks > 0 ? phaseTicks : 0,
        tick: state.tick + 1,
      },
      shots: NO_SHOTS,
    };
  }

  // Both shots are traced against the state as it stood before either of them
  // landed. Resolving one and then the other would hand whichever seat is
  // tested first a free trade, decided by nothing a player can see.
  const shots: ShotEvent[] = [];
  let nextShotId = state.nextShotId;
  const damaged = { north: 0, south: 0 };
  const fired = { north: false, south: false };
  const scored = { north: 0, south: 0 };

  for (const seat of SEATS) {
    const shooter = seat === 'north' ? north : south;
    const input = seat === 'north' ? inputs.north : inputs.south;
    if (!input.fire || !shooter.alive || shooter.cooldownTicks > 0) {
      continue;
    }

    const targetSeat = opponentOf(seat);
    const target = targetSeat === 'north' ? north : south;
    const targets: ShotTarget[] = target.alive
      ? rewoundParts(afterMove, target, targetSeat, input.rewindTicks)
      : [];

    const origin = eyePosition(shooter.body);
    // Where the shot goes rather than where it was pointed. The previous aim is
    // the one this seat held before this tick's was latched, which is what makes
    // the turning term a turn rather than a position.
    const previousAim = seat === 'north' ? state.north.aim : state.south.aim;
    const spread = spreadOf(shooter.body, previousAim, shooter.aim, input.zoomed);
    const line = deflect(shooter.aim, spread, seedOf(nextShotId, SEATS.indexOf(seat)));
    const trace = traceShot(origin, line, targets);

    shots.push({
      id: nextShotId,
      shooter: seat,
      origin,
      endpoint: trace.endpoint,
      hitPlayer: trace.hitSeat !== null,
    });
    nextShotId += 1;
    fired[seat] = true;
    if (trace.hitSeat !== null && trace.hitPart !== null) {
      damaged[trace.hitSeat] += damageOf(trace.hitPart);
      // A shot that lands is not a kill unless it finishes them, and the score
      // is a count of kills. Whether it did is settled below, where the health
      // both shots came off is known.
      if (damaged[trace.hitSeat] >= target.health) {
        scored[seat] += 1;
      }
    }
  }

  north = settle(north, 'north', damaged.north, fired.north, scored.north);
  south = settle(south, 'south', damaged.south, fired.south, scored.south);

  const winner: Seat | null =
    north.score >= WINNING_SCORE ? 'north' : south.score >= WINNING_SCORE ? 'south' : null;

  return {
    state: {
      ...afterMove,
      north,
      south,
      winner,
      phase: winner === null ? 'playing' : 'finished',
      nextShotId,
      tick: state.tick + 1,
    },
    shots,
  };
}

/** Applies a tick's outcome to one player: damage, death, respawn, cooldown, score. */
function settle(
  player: PlayerSim,
  seat: Seat,
  damage: number,
  wasFired: boolean,
  points: number,
): PlayerSim {
  // One short of the constant on the tick a shot goes out, because this tick is
  // the first of the wait rather than the last of the previous one. Set to the
  // constant itself, the gap would be one tick longer than the name promises,
  // and the name is what the Go port is written against.
  const health = player.alive ? player.health - damage : player.health;
  const next: PlayerSim = {
    ...player,
    health: health < 0 ? 0 : health,
    score: player.score + points,
    cooldownTicks: wasFired
      ? FIRE_COOLDOWN_TICKS - 1
      : player.cooldownTicks > 0
        ? player.cooldownTicks - 1
        : 0,
  };

  if (next.health <= 0 && next.alive) {
    return { ...next, alive: false, health: 0, respawnTicks: RESPAWN_TICKS };
  }

  if (!next.alive) {
    const remaining = next.respawnTicks - 1;
    return remaining > 0
      ? { ...next, respawnTicks: remaining }
      : { ...respawn(next, seat), score: next.score };
  }

  return next;
}
