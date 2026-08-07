import {
  INTERP_DELAY_TICKS,
  MAX_HEALTH,
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
import { swing, type PartBox } from '@littlegames/arena-logic';
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
  /** Whole, as the rules count it: six down to nothing. */
  readonly health: number;
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
      // Whether the player asked to crouch is a decision and belongs to the
      // moment being drawn. How far into one they are is a movement, and blends
      // — as does the size of their step. The stride phase blends too, except
      // across the wrap from one stride to the next, where blending it would
      // run the legs backwards through a whole step.
      crouchAmount: lerp(before.body.crouchAmount, target.body.crouchAmount, at),
      gaitPower: lerp(before.body.gaitPower, target.body.gaitPower, at),
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
  /** Whether this player fired it, which decides where it is drawn from. */
  readonly mine: boolean;
}

/**
 * Where one drawn tracer begins.
 *
 * The muzzle, for your own shots — but only when the shot goes past it. A
 * player firing at the floor by their feet stops the bullet at about the range
 * their own barrel reaches, and a tracer drawn from the muzzle to a point
 * beside it is a tracer of no length at all: the shot would simply not appear.
 * Below that range the eye is the honest start, and it is also the only one
 * that produces a line anybody can see.
 */
function startOf(shot: TimedShot, muzzle: Vec3 | null): Vec3 {
  if (!shot.mine || muzzle === null) {
    return shot.origin;
  }
  const reach = Math.hypot(
    muzzle.x - shot.origin.x,
    muzzle.y - shot.origin.y,
    muzzle.z - shot.origin.z,
  );
  const travelled = Math.hypot(
    shot.endpoint.x - shot.origin.x,
    shot.endpoint.y - shot.origin.y,
    shot.endpoint.z - shot.origin.z,
  );
  return travelled > reach * 2 ? muzzle : shot.origin;
}

/**
 * The shots still worth drawing, oldest first.
 *
 * Ageing happens here rather than in the renderer because the renderer holds no
 * clock — it is handed how far through its life each tracer is and draws that.
 */
export function drawableShots(
  shots: readonly TimedShot[],
  now: number,
  muzzle: Vec3 | null = null,
): ArenaShotView[] {
  const drawable: ArenaShotView[] = [];
  for (const shot of shots) {
    const left = fadeSince(now, shot.seenAt, TRACER_SECONDS);
    if (left <= 0) {
      continue;
    }
    drawable.push({
      id: shot.id,
      // Your own shots leave your own barrel. The server resolves them from the
      // eye, which is what keeps the crosshair honest, but a tracer that
      // appeared out of the middle of the screen would not look like a rifle
      // firing — so the one you can see starts where the rifle ends.
      from: startOf(shot, muzzle),
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
    // As a fraction, because the bar is a width. A dead player reads as empty
    // rather than as whatever they had left when they were finished.
    health: frame.self.alive ? Math.max(frame.self.health, 0) / MAX_HEALTH : 0,
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
    readonly viewModel: readonly PartBox[];
    /** Where this player's own shots should appear to come from. */
    readonly muzzle: Vec3 | null;
  } = {
    now: 0,
    shots: [],
    lastOwnHitAt: null,
    lastDamageAt: null,
    scope: 0,
    viewModel: [],
    muzzle: null,
  },
): ArenaView {
  const opponent = interpolateOpponent(from, to, alpha);

  return {
    camera: { position: eye, forward, fieldOfView },
    seat: from.seat,
    // Only the opponent is drawn: the camera is inside this player's own body,
    // and a box around one's own eyes is a screen full of its inside faces.
    players: opponent === null ? [] : [opponent],
    // Tracers are drawn at the moment they arrive rather than in the
    // interpolated past. A shot is an event, and an event shown late is an
    // event shown at the wrong time.
    shots: drawableShots(feedback.shots, feedback.now, feedback.muzzle),
    viewModel: feedback.viewModel,
    hud: hudFor(from, feedback.now, feedback.lastOwnHitAt, feedback.lastDamageAt, feedback.scope),
  };
}

/**
 * The rifle as its owner sees it: held at arm's length, in front of the eye.
 *
 * Placed against the camera rather than in the world, because it belongs to the
 * player looking rather than to the arena being looked at. It sways with the
 * stride — the same stride the rules carry, so it is in step with the legs
 * underneath it — and it is absent while the sight is up, since somebody
 * looking down a scope is looking down the scope and not at the rifle.
 */
export function viewModelOf(
  eye: Vec3,
  forward: Vec3,
  body: PlayerBody,
  scope: number,
): PartBox[] {
  if (scope > 0.05) {
    return [];
  }

  // A frame from the camera: right is across the view, up is whatever is left.
  const flat = Math.hypot(forward.x, forward.z) || 1;
  const right: Vec3 = { x: forward.z / flat, y: 0, z: -forward.x / flat };
  // `forward × right`, not the other way round: the other way round is the
  // same vector pointing down, and a rifle offset downwards from the eye then
  // appears above it.
  const up: Vec3 = {
    x: forward.y * right.z - forward.z * right.y,
    y: forward.z * right.x - forward.x * right.z,
    z: forward.x * right.y - forward.y * right.x,
  };

  // The sway: a small figure of eight from the stride, so the rifle breathes
  // with the walk instead of hanging in space. Scaled by the size of the step,
  // so a player standing still holds it perfectly steady.
  const stride = swing(body.gaitPhase) * body.gaitPower;
  const bob = swing((body.gaitPhase * 2) % 1) * 0.02 * body.gaitPower;
  const drift = stride * 0.024;

  const at = (rightward: number, upward: number, forwardward: number): Vec3 => ({
    x: eye.x + right.x * rightward + up.x * upward + forward.x * forwardward,
    y: eye.y + right.y * rightward + up.y * upward + forward.y * forwardward,
    z: eye.z + right.z * rightward + up.z * upward + forward.z * forwardward,
  });

  /** A box between two points held against the camera, in the camera's frame. */
  const limb = (part: PartBox['part'], from: Vec3, to: Vec3, thickness: number): PartBox => {
    const along = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const length = Math.hypot(along.x, along.y, along.z) || 1;
    const axis = { x: along.x / length, y: along.y / length, z: along.z / length };
    // A frame around that axis, taking the camera's right as the hint. Two
    // cross products, the same construction the world-space pose uses.
    const side = {
      x: axis.y * right.z - axis.z * right.y,
      y: axis.z * right.x - axis.x * right.z,
      z: axis.x * right.y - axis.y * right.x,
    };
    const sideLength = Math.hypot(side.x, side.y, side.z) || 1;
    const across = { x: side.x / sideLength, y: side.y / sideLength, z: side.z / sideLength };
    return {
      part,
      centre: {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
        z: (from.z + to.z) / 2,
      },
      half: { x: thickness, y: thickness, z: length / 2 },
      right: across,
      up: {
        x: across.y * axis.z - across.z * axis.y,
        y: across.z * axis.x - across.x * axis.z,
        z: across.x * axis.y - across.y * axis.x,
      },
      forward: axis,
    };
  };

  // Held low and to the right, the way a rifle is carried when it is not being
  // aimed through. Both hands are on it, and each arm is the box that reaches
  // from a shoulder just off the bottom of the screen to its hand.
  //
  // Everything sits a good metre out rather than a hand's breadth from the eye.
  // The arena is drawn at eighty degrees, and at close range that much
  // perspective turns a forearm into a wall: the same shapes placed further
  // away and scaled up to match cover the same part of the screen without the
  // distortion.
  const grip = at(0.33 + drift, -0.5 + bob, 0.84);
  const fore = at(0.29 + drift, -0.51 + bob, 1.3);
  const shoulderRight = at(0.52, -0.8, 0.5);
  const shoulderLeft = at(-0.34, -0.78, 0.55);

  return [
    {
      part: 'weapon',
      centre: at(0.34 + drift, -0.46 + bob, 1.15),
      half: { x: 0.05, y: 0.06, z: 0.42 },
      right,
      up,
      forward,
    },
    {
      part: 'sight',
      centre: at(0.34 + drift, -0.36 + bob, 1.02),
      half: { x: 0.035, y: 0.04, z: 0.13 },
      right,
      up,
      forward,
    },
    limb('armRight', shoulderRight, grip, 0.06),
    limb('armLeft', shoulderLeft, fore, 0.055),
  ];
}

/** Where the muzzle of that rifle is, which is where a tracer should start. */
export function viewModelMuzzle(viewModel: readonly PartBox[]): Vec3 | null {
  const barrel = viewModel.find((part) => part.part === 'weapon');
  if (barrel === undefined) {
    return null;
  }
  return {
    x: barrel.centre.x + barrel.forward.x * barrel.half.z,
    y: barrel.centre.y + barrel.forward.y * barrel.half.z,
    z: barrel.centre.z + barrel.forward.z * barrel.half.z,
  };
}

/** Where the eye sits for a predicted body, before smoothing is added. */
export function eyeOf(body: PlayerBody): Vec3 {
  return { x: body.x, y: body.y + eyeHeight(body), z: body.z };
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
