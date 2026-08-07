import { OCCLUDERS } from './arena.ts';
import type { Seat } from './arena.ts';
import type { Bounds } from './bounds.ts';
import { MAX_SHOT_DISTANCE } from './constants.ts';
import type { BodyPart } from './pose.ts';
import type { Vec3 } from './vector.ts';

/**
 * Where a shot goes, and what it finds.
 *
 * This is in the shared rules rather than on the server alone, and that was a
 * deliberate change of mind. Hit registration is the most disputed mechanic in
 * any shooter; leaving it as the one rule the conformance vectors did not pin
 * would have been leaving out the part most worth pinning. It costs one
 * carefully written slab test.
 */

/**
 * How far along the ray it enters the box, or nothing if it never does.
 *
 * The classic form of this multiplies by `1 / direction` and lets the
 * infinities sort themselves out. That form produces `0 × ∞ = NaN` for a ray
 * running parallel to a face and starting on its plane, and Go and TypeScript
 * do not agree about how a NaN travels through the comparisons that follow. So
 * a degenerate axis is branched on and never divided through.
 *
 * A ray starting inside the box enters it at zero.
 */
export function rayVsBox(
  origin: Vec3,
  direction: Vec3,
  box: Bounds,
  maxDistance: number,
): number | null {
  let enter = 0;
  let exit = maxDistance;

  if (direction.x === 0) {
    if (origin.x < box.minX || origin.x > box.maxX) {
      return null;
    }
  } else {
    const a = (box.minX - origin.x) / direction.x;
    const b = (box.maxX - origin.x) / direction.x;
    const near = a < b ? a : b;
    const far = a < b ? b : a;
    if (near > enter) {
      enter = near;
    }
    if (far < exit) {
      exit = far;
    }
    if (enter > exit) {
      return null;
    }
  }

  if (direction.y === 0) {
    if (origin.y < box.minY || origin.y > box.maxY) {
      return null;
    }
  } else {
    const a = (box.minY - origin.y) / direction.y;
    const b = (box.maxY - origin.y) / direction.y;
    const near = a < b ? a : b;
    const far = a < b ? b : a;
    if (near > enter) {
      enter = near;
    }
    if (far < exit) {
      exit = far;
    }
    if (enter > exit) {
      return null;
    }
  }

  if (direction.z === 0) {
    if (origin.z < box.minZ || origin.z > box.maxZ) {
      return null;
    }
  } else {
    const a = (box.minZ - origin.z) / direction.z;
    const b = (box.maxZ - origin.z) / direction.z;
    const near = a < b ? a : b;
    const far = a < b ? b : a;
    if (near > enter) {
      enter = near;
    }
    if (far < exit) {
      exit = far;
    }
    if (enter > exit) {
      return null;
    }
  }

  return enter;
}

/**
 * How far along the ray it enters a box with an orientation of its own.
 *
 * The same slab test, done in the box's frame instead of the world's. A part of
 * a body carries its own right, up and forward, so the ray's origin and
 * direction are projected onto those three axes with dot products and the
 * result is an axis-aligned problem again — one that reads from `-half` to
 * `+half` on each axis.
 *
 * Dot products and the existing test: no matrix, no inverse, and nothing that
 * is not a multiply and an add.
 */
export function rayVsOrientedBox(
  origin: Vec3,
  direction: Vec3,
  box: OrientedBox,
  maxDistance: number,
): number | null {
  const dx = origin.x - box.centre.x;
  const dy = origin.y - box.centre.y;
  const dz = origin.z - box.centre.z;
  const along = (axis: Vec3): number => dx * axis.x + dy * axis.y + dz * axis.z;
  const cast = (axis: Vec3): number =>
    direction.x * axis.x + direction.y * axis.y + direction.z * axis.z;

  return rayVsBox(
    { x: along(box.right), y: along(box.up), z: along(box.forward) },
    { x: cast(box.right), y: cast(box.up), z: cast(box.forward) },
    {
      minX: -box.half.x,
      minY: -box.half.y,
      minZ: -box.half.z,
      maxX: box.half.x,
      maxY: box.half.y,
      maxZ: box.half.z,
    },
    maxDistance,
  );
}

/** A box that is not aligned to the world: a limb, a torso, a rifle. */
export interface OrientedBox {
  readonly centre: Vec3;
  readonly half: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
}

/** One part of one body, where it stood at the judged moment. */
export interface ShotTarget {
  readonly seat: Seat;
  readonly part: BodyPart;
  readonly box: OrientedBox;
}

export interface Trace {
  /** Who was hit, or nobody. */
  readonly hitSeat: Seat | null;
  /** Which part of them, which is what decides the damage. */
  readonly hitPart: BodyPart | null;
  /** Where the shot stopped: a body, a wall, or the end of its range. */
  readonly endpoint: Vec3;
  readonly distance: number;
}

/**
 * Fires one shot and reports what it found.
 *
 * Walls are tested before bodies and win ties, so a target standing exactly
 * against the far side of a crate is behind it rather than in front of it.
 * Targets are given as boxes rather than as bodies because the server hands
 * over where they *were* when the shooter saw them, not where they are now.
 *
 * Every part is tested and the nearest wins, which is what makes a head shot a
 * head shot rather than whichever limb happened to be listed first — and why
 * the parts must be the same ones the renderer draws.
 */
export function traceShot(origin: Vec3, aim: Vec3, targets: readonly ShotTarget[]): Trace {
  let closest = MAX_SHOT_DISTANCE;

  for (const occluder of OCCLUDERS) {
    const distance = rayVsBox(origin, aim, occluder, closest);
    if (distance !== null && distance < closest) {
      closest = distance;
    }
  }

  let hitSeat: Seat | null = null;
  let hitPart: BodyPart | null = null;
  for (const target of targets) {
    const distance = rayVsOrientedBox(origin, aim, target.box, closest);
    if (distance !== null && distance < closest) {
      closest = distance;
      hitSeat = target.seat;
      hitPart = target.part;
    }
  }

  return {
    hitSeat,
    hitPart,
    endpoint: {
      x: origin.x + aim.x * closest,
      y: origin.y + aim.y * closest,
      z: origin.z + aim.z * closest,
    },
    distance: closest,
  };
}
