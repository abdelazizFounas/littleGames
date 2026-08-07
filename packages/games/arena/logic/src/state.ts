import { SPAWNS, SPAWN_AIM, type Seat } from './arena.ts';
import { restingBody, type PlayerBody } from './body.ts';
import { INTERP_DELAY_TICKS, MAX_HEALTH, MAX_REWIND_TICKS } from './constants.ts';
import { DEFAULT_AIM, ZERO_2, type Vec2, type Vec3 } from './vector.ts';

export type MatchPhase = 'waiting' | 'countdown' | 'playing' | 'finished';

export interface PlayerSim {
  readonly body: PlayerBody;
  /** Unit length, as the server latched it from the client's input. */
  readonly aim: Vec3;
  readonly alive: boolean;
  /**
   * What is left before the next hit is the last one.
   *
   * A whole number, and the only quantity in the rules that is. Where a hit
   * lands decides how much of it goes: the head takes all of it, the chest half
   * and a limb a third, so the same three shots kill or do not depending
   * entirely on where they were put.
   */
  readonly health: number;
  readonly score: number;
  /** Counts down to nothing, then the player is put back at their spawn. */
  readonly respawnTicks: number;
  /**
   * Bumped every time this player is put back at their spawn.
   *
   * It is on the wire, and it is load-bearing twice over. The server refuses to
   * rewind a target across one, so nobody is killed a beat after reappearing.
   * The client throws away its unacknowledged inputs when one changes, so it
   * does not replay a dead player's movement on top of a fresh spawn and skate
   * out of it.
   */
  readonly spawnEpoch: number;
  readonly cooldownTicks: number;
}

/**
 * Both bodies as they stood at the end of one past tick, and where they looked.
 *
 * The aim is here because the parts of a body are oriented by it: a shot judged
 * against a rewound body has to be judged against the pose that body was in,
 * and a pose needs a facing. Keeping only the position would rewind a target's
 * feet and leave their arms where they are now.
 */
export interface HistoryFrame {
  readonly north: PlayerBody;
  readonly south: PlayerBody;
  readonly northAim: Vec3;
  readonly southAim: Vec3;
  readonly northAlive: boolean;
  readonly southAlive: boolean;
  readonly northEpoch: number;
  readonly southEpoch: number;
}

export interface ArenaState {
  readonly phase: MatchPhase;
  readonly phaseTicks: number;
  readonly tick: number;
  readonly north: PlayerSim;
  readonly south: PlayerSim;
  readonly winner: Seat | null;
  /**
   * Where both players were, for the last `MAX_REWIND_TICKS` ticks.
   *
   * Fixed length and written to in a circle, so the state has a size rather
   * than a growth rate. This is what lag compensation rewinds into: a shooter
   * is judged against where their target was on the shooter's screen, not
   * against where it has since got to.
   */
  readonly history: readonly HistoryFrame[];
  /** Index the newest frame was written at. */
  readonly historyAt: number;
  readonly nextShotId: number;
}

/** One player's intent for one tick, dequantised and ready to simulate. */
export interface ArenaInput {
  readonly move: Vec2;
  readonly aim: Vec3;
  readonly jump: boolean;
  readonly crouch: boolean;
  readonly fire: boolean;
  /**
   * Whether the sight was up when this command was sampled.
   *
   * It reaches the rules for one reason: a scoped shot is nearly true and a hip
   * shot is not. It changes nothing else, and in particular it does not change
   * the field of view, which is the client's business alone.
   */
  readonly zoomed: boolean;
  /** How far back this player's screen was, already clamped. */
  readonly rewindTicks: number;
}

export interface ArenaInputs {
  readonly north: ArenaInput;
  readonly south: ArenaInput;
}

export const NO_INPUT: ArenaInput = {
  move: ZERO_2,
  aim: DEFAULT_AIM,
  jump: false,
  crouch: false,
  fire: false,
  zoomed: false,
  rewindTicks: 0,
};

function spawn(seat: Seat, epoch: number): PlayerSim {
  return {
    body: restingBody(SPAWNS[seat]),
    aim: SPAWN_AIM[seat],
    alive: true,
    health: MAX_HEALTH,
    score: 0,
    respawnTicks: 0,
    spawnEpoch: epoch,
    cooldownTicks: 0,
  };
}

/**
 * Puts a player back at their spawn, keeping their score and bumping the epoch.
 *
 * Health comes back whole with everything else, because it is built from a
 * fresh spawn rather than patched onto the old player.
 */
export function respawn(player: PlayerSim, seat: Seat): PlayerSim {
  return {
    ...spawn(seat, player.spawnEpoch + 1),
    score: player.score,
  };
}

function emptyFrame(): HistoryFrame {
  return {
    north: restingBody(SPAWNS.north),
    south: restingBody(SPAWNS.south),
    northAim: SPAWN_AIM.north,
    southAim: SPAWN_AIM.south,
    northAlive: true,
    southAlive: true,
    northEpoch: 0,
    southEpoch: 0,
  };
}

export function createInitialState(): ArenaState {
  return {
    phase: 'waiting',
    phaseTicks: 0,
    tick: 0,
    north: spawn('north', 0),
    south: spawn('south', 0),
    winner: null,
    history: Array.from({ length: MAX_REWIND_TICKS }, emptyFrame),
    historyAt: 0,
    nextShotId: 1,
  };
}

/** Opens the countdown, once both seats are filled. */
export function startCountdown(state: ArenaState, countdownTicks: number): ArenaState {
  return state.phase === 'waiting'
    ? { ...state, phase: 'countdown', phaseTicks: countdownTicks }
    : state;
}

/**
 * How far back a shooter's view was, from the newest tick they said they held.
 *
 * `seenTick` comes from the client, which is why every part of this is
 * clamped. A client that claims to have seen the future is pulled back to the
 * present; one that claims a tick older than the ring is pulled forward to the
 * oldest frame there is. Claiming to have seen *less* than it did is allowed
 * and pointless — it only makes the shot resolve against fresher positions,
 * which is to say against a target that has had longer to move away.
 *
 * The interpolation delay is added because the client draws the opponent that
 * far behind the snapshot it holds, and it is the drawn opponent that was
 * aimed at.
 */
export function clampRewind(seenTick: number, currentTick: number): number {
  const behind = currentTick - seenTick;
  const total = (behind < 0 ? 0 : behind) + INTERP_DELAY_TICKS;
  return total > MAX_REWIND_TICKS - 1 ? MAX_REWIND_TICKS - 1 : total;
}

/** Reads the ring, `back` ticks before the newest frame written. */
export function historyAt(state: ArenaState, back: number): HistoryFrame {
  const length = state.history.length;
  const clamped = back < 0 ? 0 : back > length - 1 ? length - 1 : back;
  const index = (((state.historyAt - clamped) % length) + length) % length;
  return state.history[index] ?? emptyFrame();
}

export function playerOf(state: ArenaState, seat: Seat): PlayerSim {
  return seat === 'north' ? state.north : state.south;
}
