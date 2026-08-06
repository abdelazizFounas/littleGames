import { COLLIDERS } from './arena.ts';
import type { Box } from './arena.ts';
import type { Bounds } from './bounds.ts';
import {
  CROUCH_EYE,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  GRAVITY,
  JUMP_SPEED,
  MOVE_SPEED,
  PLAYER_HALF,
  STAND_EYE,
  STAND_HEIGHT,
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
}

/** One tick of intent, with the move already shortened to at most unit length. */
export interface MoveIntent {
  readonly move: Vec2;
  readonly jump: boolean;
  readonly crouch: boolean;
}

export function bodyHeight(crouching: boolean): number {
  return crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
}

export function eyeHeight(crouching: boolean): number {
  return crouching ? CROUCH_EYE : STAND_EYE;
}

/** Where a body's eyes are, which is where the camera and the muzzle sit. */
export function eyePosition(body: PlayerBody): { x: number; y: number; z: number } {
  return { x: body.x, y: body.y + eyeHeight(body.crouching), z: body.z };
}

/** The box a body occupies, which is also the box a bullet has to hit. */
export function bodyBounds(body: PlayerBody): Bounds {
  return {
    minX: body.x - PLAYER_HALF,
    minY: body.y,
    minZ: body.z - PLAYER_HALF,
    maxX: body.x + PLAYER_HALF,
    maxY: body.y + bodyHeight(body.crouching),
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

  const height = bodyHeight(crouching);
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

  return { x, y, z, vy, grounded, crouching };
}

/** A body standing still at a spawn point, which is how every life starts. */
export function restingBody(at: { x: number; y: number; z: number }): PlayerBody {
  return { x: at.x, y: at.y, z: at.z, vy: 0, grounded: false, crouching: false };
}

export { MOVE_SPEED, PLAYER_HALF };
