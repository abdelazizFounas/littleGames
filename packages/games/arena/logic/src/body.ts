import { COLLIDERS } from './arena.ts';
import type { Box } from './arena.ts';
import type { Bounds } from './bounds.ts';
import {
  CROUCH_EYE,
  CROUCH_HEIGHT,
  CROUCH_PER_TICK,
  CROUCH_SPEED,
  GAIT_SETTLE_PER_TICK,
  GRAVITY,
  JUMP_SPEED,
  MOVE_SPEED,
  PLAYER_HALF,
  STAND_EYE,
  STAND_HEIGHT,
  STRIDE_METRES,
  TICK_SECONDS,
} from './constants.ts';
import type { Vec2 } from './vector.ts';

/**
 * How a body moves, and the only rule the client runs as well as the server.
 *
 * Prediction replays this exact function over unacknowledged commands, so any
 * difference between the two implementations shows up as the camera being
 * corrected — a jolt in first person, where the camera *is* the player. The
 * conformance vectors exist to make that impossible rather than unlikely.
 *
 * Nothing here needs a square root or a trigonometric function. Axes resolve
 * one at a time, so a resolution is a comparison and an assignment.
 */

export interface PlayerBody {
  /** Feet, not eyes: the box stands on this point. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Vertical speed. Horizontal speed is not carried — there is no inertia. */
  readonly vy: number;
  readonly grounded: boolean;
  readonly crouching: boolean;
  /**
   * Where this body is in its stride, from zero to one.
   *
   * In the rules rather than in the renderer, and that is the whole point: the
   * limbs that get drawn are the limbs that get shot at, so both sides have to
   * agree on where they are. It advances with ground actually covered, so it is
   * the same on the server, on the client predicting ahead, and in the vectors.
   */
  readonly gaitPhase: number;
  /**
   * How far into a crouch this body is, from standing to fully down.
   *
   * A number rather than the flag it used to be, so the body has somewhere to
   * be between the two. Height, eye and hitbox all follow it, which is what
   * keeps what is drawn and what can be hit the same thing throughout the
   * movement rather than only at its ends.
   */
  readonly crouchAmount: number;
}

/** One tick of intent, with the move already shortened to at most unit length. */
export interface MoveIntent {
  readonly move: Vec2;
  readonly jump: boolean;
  readonly crouch: boolean;
}

/** A body part way into a crouch, which is where most of one is spent. */
export interface Crouchable {
  readonly crouchAmount: number;
}

/** How tall a body stands, at either end of a crouch or anywhere between. */
export function bodyHeight(body: Crouchable): number {
  return STAND_HEIGHT + float((CROUCH_HEIGHT - STAND_HEIGHT) * body.crouchAmount);
}

export function eyeHeight(body: Crouchable): number {
  return STAND_EYE + float((CROUCH_EYE - STAND_EYE) * body.crouchAmount);
}

/** Where a body's eyes are, which is where the camera sits. */
export function eyePosition(body: PlayerBody): { x: number; y: number; z: number } {
  return { x: body.x, y: body.y + eyeHeight(body), z: body.z };
}

/** The box a body occupies, which is also the box a bullet has to hit. */
export function bodyBounds(body: PlayerBody): Bounds {
  return {
    minX: body.x - PLAYER_HALF,
    minY: body.y,
    minZ: body.z - PLAYER_HALF,
    maxX: body.x + PLAYER_HALF,
    maxY: body.y + bodyHeight(body),
    maxZ: body.z + PLAYER_HALF,
  };
}

function boundsAt(x: number, y: number, z: number, height: number): Bounds {
  return {
    minX: x - PLAYER_HALF,
    minY: y,
    minZ: z - PLAYER_HALF,
    maxX: x + PLAYER_HALF,
    maxY: y + height,
    maxZ: z + PLAYER_HALF,
  };
}

function hitsAnything(candidate: Bounds): boolean {
  for (const collider of COLLIDERS) {
    if (
      candidate.minX < collider.maxX &&
      candidate.maxX > collider.minX &&
      candidate.minY < collider.maxY &&
      candidate.maxY > collider.minY &&
      candidate.minZ < collider.maxZ &&
      candidate.maxZ > collider.minZ
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Where an axis ends up after being pushed out of everything it entered.
 *
 * The overlap is tested against the *unresolved* position for every collider,
 * and the most restrictive push wins. Resolving against one box and then
 * re-testing against the next would make the answer depend on the order the
 * boxes happen to be in, which is exactly the kind of thing that agrees in
 * TypeScript and disagrees in Go.
 *
 * @param pick - The face to stop against, given a box that was entered.
 */
function resolveAxis(
  moved: Bounds,
  target: number,
  forward: boolean,
  pick: (collider: Box) => number,
): number {
  let resolved = target;
  for (const collider of COLLIDERS) {
    if (
      moved.minX < collider.maxX &&
      moved.maxX > collider.minX &&
      moved.minY < collider.maxY &&
      moved.maxY > collider.minY &&
      moved.minZ < collider.maxZ &&
      moved.maxZ > collider.minZ
    ) {
      const stop = pick(collider);
      if (forward ? stop < resolved : stop > resolved) {
        resolved = stop;
      }
    }
  }
  return resolved;
}

/**
 * Advances one body by a tick.
 *
 * Axes resolve X, then Z, then Y, and `grounded` comes out of the Y pass. That
 * order is load-bearing: it is what lets a body slide along a crate face
 * instead of stopping dead against it, and the Go port resolves in the same
 * order. A dedicated vector scenario walks a body into every face and every
 * inside corner in the arena to hold the two together.
 */
export function stepBody(body: PlayerBody, intent: MoveIntent): PlayerBody {
  // Crouching is granted on request and only released when there is room. A
  // player who ducks under a ledge and lets go of the key stays crouched until
  // they walk out from under it, rather than standing up through it.
  let crouching = body.crouching;
  if (intent.crouch) {
    crouching = true;
  } else if (crouching && !hitsAnything(boundsAt(body.x, body.y, body.z, STAND_HEIGHT))) {
    crouching = false;
  }

  // Part way down counts as down for everything it costs: the height a body
  // occupies follows the movement rather than waiting for it to finish.
  const crouchAmount = settleCrouch(body.crouchAmount, crouching);
  const height = bodyHeight({ crouchAmount });
  const speed = crouching ? CROUCH_SPEED : MOVE_SPEED;

  let { x, y, z } = body;

  const dx = intent.move.x * speed * TICK_SECONDS;
  if (dx !== 0) {
    const moved = x + dx;
    x = resolveAxis(
      boundsAt(moved, y, z, height),
      moved,
      dx > 0,
      (collider) => (dx > 0 ? collider.minX - PLAYER_HALF : collider.maxX + PLAYER_HALF),
    );
  }

  const dz = intent.move.z * speed * TICK_SECONDS;
  if (dz !== 0) {
    const moved = z + dz;
    z = resolveAxis(
      boundsAt(x, y, moved, height),
      moved,
      dz > 0,
      (collider) => (dz > 0 ? collider.minZ - PLAYER_HALF : collider.maxZ + PLAYER_HALF),
    );
  }

  // A jump is read before gravity, so the impulse survives the tick it was
  // asked for. Held rather than edge-triggered: holding the key hops, which is
  // one fewer piece of state to keep in step across two languages.
  let vy = intent.jump && body.grounded ? JUMP_SPEED : body.vy;
  vy -= GRAVITY * TICK_SECONDS;

  const dy = vy * TICK_SECONDS;
  let grounded = false;
  if (dy !== 0) {
    const moved = y + dy;
    const resolved = resolveAxis(
      boundsAt(x, moved, z, height),
      moved,
      dy > 0,
      (collider) => (dy > 0 ? collider.minY - height : collider.maxY),
    );
    if (resolved !== moved) {
      // Stopped by something. Downwards that is the ground; upwards it is a
      // ceiling, and either way the vertical speed is spent.
      grounded = dy < 0;
      vy = 0;
    }
    y = resolved;
  }

  // Measured from where the body ended up, not from where it meant to go: a
  // player walking into a wall covers no ground and takes no steps.
  const travelledX = x - body.x;
  const travelledZ = z - body.z;
  const travelled = Math.sqrt(
    float(travelledX * travelledX) + float(travelledZ * travelledZ),
  );

  return {
    x,
    y,
    z,
    vy,
    grounded,
    crouching,
    crouchAmount,
    gaitPhase: nextGait(body.gaitPhase, travelled, grounded),
  };
}

/** Moves a body one tick further into a crouch, or one tick out of it. */
function settleCrouch(amount: number, crouching: boolean): number {
  const target = crouching ? 1 : 0;
  const gap = target - amount;
  if (gap > CROUCH_PER_TICK) {
    return amount + CROUCH_PER_TICK;
  }
  if (gap < -CROUCH_PER_TICK) {
    return amount - CROUCH_PER_TICK;
  }
  return target;
}

/**
 * Rounds an intermediate product before it is added to something.
 *
 * A no-op in JavaScript, which always rounds. Its counterpart in the Go port is
 * an explicit float64 conversion, which is what stops the compiler fusing a
 * multiply and an add into a single rounding on ARM.
 */
function float(value: number): number {
  return value;
}

/** A body standing still at a spawn point, which is how every life starts. */
export function restingBody(at: { x: number; y: number; z: number }): PlayerBody {
  return {
    x: at.x,
    y: at.y,
    z: at.z,
    vy: 0,
    grounded: false,
    crouching: false,
    crouchAmount: 0,
    gaitPhase: FEET_TOGETHER_EARLY,
  };
}

/**
 * The two phases at which the legs are level under the body.
 *
 * The stride is a triangle wave, so it passes through zero swing twice: a
 * quarter of the way through and three quarters. Standing still means settling
 * on whichever of the two is nearer.
 */
export const FEET_TOGETHER_EARLY = 0.25;
export const FEET_TOGETHER_LATE = 0.75;

/**
 * Advances the stride by the ground actually covered, or settles it.
 *
 * Only while grounded: legs that keep striding through a jump look like
 * running in mid-air, which is a thing cartoons do and shooters do not.
 */
function nextGait(phase: number, travelled: number, grounded: boolean): number {
  if (!grounded) {
    return phase;
  }
  if (travelled > 0) {
    const advanced = phase + travelled / STRIDE_METRES;
    // Wrapped by subtraction rather than by a modulo: exact in both languages,
    // and the distance covered in one tick can never span a whole stride.
    return advanced >= 1 ? advanced - 1 : advanced;
  }

  const target =
    phase - FEET_TOGETHER_EARLY < FEET_TOGETHER_LATE - phase
      ? FEET_TOGETHER_EARLY
      : FEET_TOGETHER_LATE;
  const gap = target - phase;
  if (gap > GAIT_SETTLE_PER_TICK) {
    return phase + GAIT_SETTLE_PER_TICK;
  }
  if (gap < -GAIT_SETTLE_PER_TICK) {
    return phase - GAIT_SETTLE_PER_TICK;
  }
  return target;
}

export { MOVE_SPEED, PLAYER_HALF };
