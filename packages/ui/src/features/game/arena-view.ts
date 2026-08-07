import {
  INTERP_DELAY_TICKS,
  RESPAWN_TICKS,
  TICK_RATE,
  TICK_SECONDS,
  WINNING_SCORE,
  clampToUnit,
  eyeHeight,
  moveFromWire,
  opponentOf,
  stepBody,
  type PlayerBody,
  type Seat,
  type Vec3,
} from '@littlegames/arena-logic';
import type {
  ArenaHud,
  ArenaPlayerView,
  ArenaShotView,
  ArenaView,
} from '@littlegames/arena-renderer-babylon';
import { reconcile } from '@littlegames/net';
import type { ArenaCommand } from './arena-input-sources';

/**
 * Choosing the single picture to draw, out of everything the client holds.
 *
 * Pulled out of the session loop for the same reason `pong-frame.ts` was: it
 * decides what the player actually sees, it has several awkward cases in it,
 * and buried in a closure none of them could be pinned down. Everything here is
 * a pure function of its arguments.
 */

/**
 * How far behind live the opponent is drawn.
 *
 * Taken from the rules rather than chosen here, and that is the point: the
 * server adds exactly this to every rewind when it judges a shot, because a
 * shooter aimed at what their screen showed and their screen was this far
 * behind. A client that drew further behind than the server compensates would
 * be under-compensated by the difference — its shots would miss a target that
 * was, on its own screen, dead centre.
 */
export const INTERPOLATION_DELAY_MS = INTERP_DELAY_TICKS * TICK_SECONDS * 1000;

/** One player as the client keeps them, straight off the wire. */
export interface FramePlayer {
  readonly seat: Seat;
  readonly body: PlayerBody;
  readonly aim: Vec3;
  readonly alive: boolean;
  readonly score: number;
  readonly respawnTicks: number;
  readonly spawnEpoch: number;
  /** Whether they have said they are ready. Only meaningful before the start. */
  readonly ready: boolean;
}

/** A whole snapshot as the client keeps it, plus who we are in it. */
export interface ArenaFrame {
  readonly tick: number;
  readonly phase: 'waiting' | 'countdown' | 'playing' | 'finished';
  readonly phaseTicks: number;
  readonly seat: Seat;
  readonly acknowledgedSeq: number;
  readonly self: FramePlayer;
  readonly opponent: FramePlayer | null;
  readonly winner: Seat | null;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/**
 * Whether two frames describe a continuous moment for a given player.
 *
 * A respawn moves a body the length of the arena in one tick. Interpolating
 * across it would draw the opponent sliding back from where they died to their
 * spawn, through every wall in between, so a window straddling one holds the
 * earlier frame instead.
 */
export function isContinuous(from: FramePlayer | null, to: FramePlayer | null): boolean {
  return from !== null && to !== null && from.spawnEpoch === to.spawnEpoch;
}

/** The opponent, drawn between the two snapshots that bracket the moment. */
export function interpolateOpponent(
  from: ArenaFrame,
  to: ArenaFrame,
  alpha: number,
): ArenaPlayerView | null {
  const before = from.opponent;
  if (before === null) {
    return null;
  }
  const after = to.opponent;
  const at = isContinuous(before, after) ? alpha : 0;
  const target = at === 0 || after === null ? before : after;

  return {
    seat: before.seat,
    body: {
      ...before.body,
      x: lerp(before.body.x, target.body.x, at),
      y: lerp(before.body.y, target.body.y, at),
      z: lerp(before.body.z, target.body.z, at),
      // Crouching is a discrete state and belongs to the moment being drawn:
      // blending it would mean drawing a body at no height either player has.
      // The stride is continuous and blends, except across the wrap from one
      // stride to the next, where blending would run the legs backwards.
      gaitPhase:
        Math.abs(target.body.gaitPhase - before.body.gaitPhase) > 0.5
          ? before.body.gaitPhase
          : lerp(before.body.gaitPhase, target.body.gaitPhase, at),
    },
    aim: before.aim,
    alive: before.alive,
  };
}

/**
 * This player's own body, brought forward from the server's copy to now.
 *
 * The commands are replayed exactly as they went out — the very integers, not
 * the floats they were computed from — because that is what the server will
 * execute. Replaying the floats instead would drift by a hair every tick and
 * never settle.
 *
 * A dead player is not stepped at all, which is what the server does with a
 * dead player's intent.
 */
export function predictSelf(
  authoritative: FramePlayer,
  pending: readonly ArenaCommand[],
): PlayerBody {
  if (!authoritative.alive) {
    return authoritative.body;
  }
  return reconcile(authoritative.body, pending, (body, command) =>
    stepBody(body, {
      move: clampToUnit(moveFromWire(command.moveX, command.moveZ)),
      jump: command.jump,
      crouch: command.crouch,
    }),
  );
}

/**
 * How far the drawn camera still is from where prediction now says it should be.
 *
 * A snapshot that disagrees with the prediction moves the eye, and in first
 * person the eye is the player: snapping it is felt as the world being yanked.
 * The difference is therefore kept as an offset and decayed away over a few
 * frames, so the correction happens where it belongs — in what is drawn, never
 * in the simulated state, which must stay exactly what the server will compute.
 */
export interface CameraSmoothing {
  readonly offset: Vec3;
  /** The spawn epoch the offset was measured under. */
  readonly epoch: number;
}

export const NO_SMOOTHING: CameraSmoothing = { offset: { x: 0, y: 0, z: 0 }, epoch: 0 };

/**
 * Past this, in metres, the correction is not smoothed but taken at once.
 *
 * A metre and a half of error is not a hair of drift to be blended away; it is
 * the client having been wrong about something, and gliding smoothly to the
 * truth over a second would leave the player shooting from somewhere they are
 * not for the whole of it.
 */
export const SNAP_DISTANCE_METRES = 1.5;

/** How long half of a correction takes to disappear. */
export const CORRECTION_HALF_LIFE_MS = 60;

/**
 * Folds a new prediction into the smoothing state.
 *
 * The offset is dropped outright when the spawn epoch changes: the player has
 * been put back at their spawn, and the distance between where they died and
 * where they reappeared is not an error to be eased away — easing it would
 * slide the camera out of the spawn point across the whole arena.
 */
export function smoothCamera(
  previous: CameraSmoothing,
  drawnBefore: Vec3 | null,
  predicted: Vec3,
  epoch: number,
  elapsedMs: number,
): CameraSmoothing {
  if (previous.epoch !== epoch || drawnBefore === null) {
    return { offset: { x: 0, y: 0, z: 0 }, epoch };
  }

  const wanted = {
    x: drawnBefore.x - predicted.x,
    y: drawnBefore.y - predicted.y,
    z: drawnBefore.z - predicted.z,
  };
  if (Math.hypot(wanted.x, wanted.y, wanted.z) > SNAP_DISTANCE_METRES) {
    return { offset: { x: 0, y: 0, z: 0 }, epoch };
  }

  // Halved every half-life, which is frame-rate independent: the same
  // correction takes the same time to fade at 60 Hz and at 144 Hz.
  const decay = Math.pow(0.5, Math.max(elapsedMs, 0) / CORRECTION_HALF_LIFE_MS);
  return {
    offset: { x: wanted.x * decay, y: wanted.y * decay, z: wanted.z * decay },
    epoch,
  };
}

/**
 * How long a tracer stays on screen, in seconds.
 *
 * Long enough to be caught from the corner of an eye — and it has to be, since
 * the whole use of seeing a tracer is learning where the shot came from before
 * the next one. Short enough that the arena is never criss-crossed by the last
 * ten seconds of the round: a shot is an event, not a decoration.
 */
export const TRACER_SECONDS = 0.28;

/** How long the mark stays up after a shot of yours connects. */
export const HIT_MARKER_SECONDS = 0.35;

/** How long the screen stays red after you are hit. */
export const DAMAGE_SECONDS = 0.6;

/**
 * One down to nothing over a lifetime, and nothing before it started.
 *
 * `never` — no such moment yet — is deliberately a value rather than a branch at
 * every call site: the first frame of a match has no last death and no last hit,
 * and both have to fade to nothing rather than to a flash.
 */
export function fadeSince(now: number, at: number | null, lifetimeSeconds: number): number {
  if (at === null) {
    return 0;
  }
  const elapsed = (now - at) / 1000;
  if (elapsed < 0 || elapsed >= lifetimeSeconds) {
    return 0;
  }
  return 1 - elapsed / lifetimeSeconds;
}

/** A shot the server resolved, aged into something drawable. */
export interface TimedShot {
  readonly id: number;
  readonly origin: Vec3;
  readonly endpoint: Vec3;
  readonly hitPlayer: boolean;
  /** When this client first saw it, on the same clock as `now`. */
  readonly seenAt: number;
}

/**
 * The shots still worth drawing, oldest first.
 *
 * Ageing happens here rather than in the renderer because the renderer holds no
 * clock — it is handed how far through its life each tracer is and draws that.
 */
export function drawableShots(shots: readonly TimedShot[], now: number): ArenaShotView[] {
  const drawable: ArenaShotView[] = [];
  for (const shot of shots) {
    const left = fadeSince(now, shot.seenAt, TRACER_SECONDS);
    if (left <= 0) {
      continue;
    }
    drawable.push({
      id: shot.id,
      from: shot.origin,
      to: shot.endpoint,
      hitPlayer: shot.hitPlayer,
      fade: 1 - left,
    });
  }
  return drawable;
}

function messageFor(frame: ArenaFrame): string {
  switch (frame.phase) {
    case 'waiting':
      // Nothing: before the round opens the ready panel is over the arena and
      // says everything there is to say. A second message under it would only
      // repeat it.
      return '';
    case 'countdown':
      // Rounded up, so the last whole second is shown as 1 rather than 0.
      return String(Math.ceil(frame.phaseTicks / TICK_RATE));
    case 'finished':
      return frame.winner === frame.seat ? 'You win' : 'You lose';
    default:
      return '';
  }
}

export function hudFor(
  frame: ArenaFrame,
  now = 0,
  lastOwnHitAt: number | null = null,
  lastDamageAt: number | null = null,
  scope = 0,
): ArenaHud {
  return {
    ownScore: frame.self.score,
    opponentScore: frame.opponent?.score ?? 0,
    message: messageFor(frame),
    respawnSeconds: frame.self.alive
      ? 0
      : Math.min(frame.self.respawnTicks, RESPAWN_TICKS) / TICK_RATE,
    crosshair: frame.phase === 'playing' && frame.self.alive,
    scope,
    hitMarker: fadeSince(now, lastOwnHitAt, HIT_MARKER_SECONDS),
    damage: fadeSince(now, lastDamageAt, DAMAGE_SECONDS),
  };
}

/**
 * Builds the whole picture.
 *
 * Everything discrete — the score, the phase, the countdown — comes from the
 * interpolated past along with the opponent, so the numbers on screen describe
 * the same moment as the bodies. This player's own eye is the exception and
 * stays at the present: it answers the mouse directly, and a camera that
 * replied a tenth of a second late is the one lag nobody tolerates.
 */
export function composeArenaView(
  from: ArenaFrame,
  to: ArenaFrame,
  alpha: number,
  eye: Vec3,
  forward: Vec3,
  fieldOfView: number,
  feedback: {
    readonly now: number;
    readonly shots: readonly TimedShot[];
    readonly lastOwnHitAt: number | null;
    readonly lastDamageAt: number | null;
    readonly scope: number;
  } = { now: 0, shots: [], lastOwnHitAt: null, lastDamageAt: null, scope: 0 },
): ArenaView {
  const opponent = interpolateOpponent(from, to, alpha);

  return {
    camera: { position: eye, forward, fieldOfView },
    // Only the opponent is drawn: the camera is inside this player's own body,
    // and a box around one's own eyes is a screen full of its inside faces.
    players: opponent === null ? [] : [opponent],
    // Tracers are drawn at the moment they arrive rather than in the
    // interpolated past. A shot is an event, and an event shown late is an
    // event shown at the wrong time.
    shots: drawableShots(feedback.shots, feedback.now),
    hud: hudFor(from, feedback.now, feedback.lastOwnHitAt, feedback.lastDamageAt, feedback.scope),
  };
}

/** Where the eye sits for a predicted body, before smoothing is added. */
export function eyeOf(body: PlayerBody): Vec3 {
  return { x: body.x, y: body.y + eyeHeight(body.crouching), z: body.z };
}

/** Whether this seat has won, which the stage reports without re-rendering. */
export function isDecided(frame: ArenaFrame): boolean {
  return (
    frame.phase === 'finished' ||
    frame.self.score >= WINNING_SCORE ||
    (frame.opponent?.score ?? 0) >= WINNING_SCORE
  );
}

export { opponentOf };
