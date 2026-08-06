import { AIM_SCALE, MAX_WIRE_AIM, MAX_WIRE_MOVE, MOVE_SCALE } from './constants.ts';

/**
 * Vectors, and the wire's integers.
 *
 * The simulation never sees an angle. A client resolves its own yaw and pitch
 * into world-space directions and sends those, so `sin` and `cos` stay in the
 * input source where they belong — presentation, not rules. That is what keeps
 * the whole simulation inside `+ - * /`, comparisons and `sqrt`, all of which
 * IEEE-754 rounds exactly in both languages.
 *
 * It gives nothing away. A client that can look anywhere can already move in
 * any direction; the only thing four direction bits ever enforced was a speed
 * cap, and `clampToUnit` enforces it exactly.
 */

/** Across the arena and along it. There is no vertical intent. */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO_2: Vec2 = { x: 0, z: 0 };

/** Aim used when a client sends something degenerate. Down the arena. */
export const DEFAULT_AIM: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * A quantised wire integer back to a number.
 *
 * Exact: the scale is a power of two, so this is an exponent adjustment and
 * nothing is rounded. Both languages land on the identical double, which is the
 * whole reason the wire carries integers.
 */
export function fromWire(quantised: number, scale: number): number {
  return quantised / scale;
}

/** A number to a wire integer, rounded once and clamped to what is accepted. */
export function toWire(value: number, scale: number, limit: number): number {
  const scaled = Math.round(value * scale);
  if (scaled < -limit) {
    return -limit;
  }
  return scaled > limit ? limit : scaled;
}

export function moveToWire(move: Vec2): { readonly x: number; readonly z: number } {
  return {
    x: toWire(move.x, MOVE_SCALE, MAX_WIRE_MOVE),
    z: toWire(move.z, MOVE_SCALE, MAX_WIRE_MOVE),
  };
}

export function moveFromWire(x: number, z: number): Vec2 {
  return { x: fromWire(x, MOVE_SCALE), z: fromWire(z, MOVE_SCALE) };
}

export function aimToWire(aim: Vec3): Vec3 {
  return {
    x: toWire(aim.x, AIM_SCALE, MAX_WIRE_AIM),
    y: toWire(aim.y, AIM_SCALE, MAX_WIRE_AIM),
    z: toWire(aim.z, AIM_SCALE, MAX_WIRE_AIM),
  };
}

export function aimFromWire(x: number, y: number, z: number): Vec3 {
  return { x: fromWire(x, AIM_SCALE), y: fromWire(y, AIM_SCALE), z: fromWire(z, AIM_SCALE) };
}

/**
 * Shortens a move to at most unit length, leaving a shorter one alone.
 *
 * This is the speed cap, and it is the only thing standing between the server
 * and a client that claims to be pushing its stick twice as far as a stick
 * goes. Shortening rather than rejecting is deliberate: an analogue stick at
 * half deflection is a legitimate half-speed walk, and a touch joystick
 * produces those constantly.
 */
export function clampToUnit(move: Vec2): Vec2 {
  const lengthSquared = move.x * move.x + move.z * move.z;
  if (lengthSquared <= 1) {
    return move;
  }
  const length = Math.sqrt(lengthSquared);
  return { x: move.x / length, z: move.z / length };
}

/**
 * A unit-length aim, or a fixed fallback when the client sent a degenerate one.
 *
 * A zero vector has no direction to normalise, and a ray without a direction
 * would divide its way to infinities in the slab test. The fallback is a fixed
 * direction rather than the previous aim so that this stays a pure function of
 * its argument, which is what lets it go in the vectors.
 */
export function normalizeAim(aim: Vec3): Vec3 {
  const lengthSquared = aim.x * aim.x + aim.y * aim.y + aim.z * aim.z;
  if (lengthSquared <= 0) {
    return DEFAULT_AIM;
  }
  const length = Math.sqrt(lengthSquared);
  return { x: aim.x / length, y: aim.y / length, z: aim.z / length };
}
