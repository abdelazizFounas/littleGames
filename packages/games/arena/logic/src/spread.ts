import {
  SPREAD_AIRBORNE,
  SPREAD_BASE,
  SPREAD_MOVING,
  SPREAD_SCOPED_SHARE,
  SPREAD_TURNING,
} from './constants.ts';
import type { PlayerBody } from './body.ts';
import type { Vec3 } from './vector.ts';

/**
 * Where a shot goes, as opposed to where it was aimed.
 *
 * A rifle that always lands on the crosshair makes movement free: there is no
 * reason ever to stop, to crouch, or to raise the sight. Spread is the price of
 * all three, and it is charged from state both sides already hold — how big a
 * step the shooter is taking, whether their feet are on the ground, how far
 * they swung their aim in the last tick — so it needs no accumulator and
 * tightens on its own the moment a player stands still.
 *
 * Two things make it safe to put in the rules. The randomness is integer, not
 * floating point: a `xorshift32` over a `uint32`, which is exactly the same
 * sequence in Go and in JavaScript and cannot round differently. And the
 * deflection is built with cross products rather than angles, so the whole file
 * stays inside the arithmetic the conformance vectors can pin.
 */

/**
 * One step of xorshift32, in the only way JavaScript can do it exactly.
 *
 * `Math.imul` multiplies as 32-bit integers rather than as doubles, and `>>> 0`
 * puts the result back in the unsigned range after every shift and xor. Written
 * with plain `*` this would silently become double arithmetic somewhere past
 * two to the fifty-third and stop matching the Go port.
 */
export function xorshift32(state: number): number {
  let value = state >>> 0;
  // A zero state is a fixed point: it would return zero for ever, and every
  // shot seeded to it would land dead centre.
  if (value === 0) {
    value = 0x9e3779b9;
  }
  value = (value ^ (value << 13)) >>> 0;
  value = (value ^ (value >>> 17)) >>> 0;
  value = (value ^ (value << 5)) >>> 0;
  return value >>> 0;
}

/**
 * A seed for one shot, from the two things that identify it.
 *
 * The shot's own id and the seat that fired it, mixed with an odd constant so
 * that consecutive ids do not produce neighbouring seeds. Both sides know both
 * numbers before the shot is resolved, which is the whole requirement.
 */
export function seedOf(shotId: number, seatIndex: number): number {
  return (Math.imul(shotId, 0x9e3779b1) + Math.imul(seatIndex + 1, 0x85ebca6b)) >>> 0;
}

/**
 * A random number from minus one to just under one.
 *
 * Divided by a power of two, so it is exact in binary floating point and lands
 * on the identical double in both languages — the same reason the wire
 * quantises onto powers of two.
 */
export function unitFrom(state: number): number {
  return (state >>> 0) / 2147483648 - 1;
}

/**
 * How wide this shooter's shot may stray, in sideways metres per metre flown.
 *
 * Everything adds, and everything but the base can be got rid of: stop moving
 * and the movement term goes with the size of the step, land and the airborne
 * term goes, hold the aim still and the turning term goes. Raising the sight
 * shrinks what is left of all of them to almost nothing, which is what makes it
 * a trade rather than a button.
 */
export function spreadOf(
  body: PlayerBody,
  previousAim: Vec3,
  aim: Vec3,
  zoomed: boolean,
): number {
  const turned = Math.sqrt(
    (aim.x - previousAim.x) * (aim.x - previousAim.x) +
      (aim.y - previousAim.y) * (aim.y - previousAim.y) +
      (aim.z - previousAim.z) * (aim.z - previousAim.z),
  );

  const total =
    SPREAD_BASE +
    SPREAD_MOVING * body.gaitPower +
    (body.grounded ? 0 : SPREAD_AIRBORNE) +
    SPREAD_TURNING * turned;

  return zoomed ? total * SPREAD_SCOPED_SHARE : total;
}

/**
 * The aim, nudged off centre by this shot's own share of the spread.
 *
 * Two offsets in the plane across the aim rather than one, or every shot from a
 * given position would stray along the same line. The plane is built from cross
 * products against whichever world axis the aim is least parallel to — picked
 * by comparison, so there is no angle and no degenerate case where the aim
 * happens to point straight up.
 */
export function deflect(aim: Vec3, spread: number, seed: number): Vec3 {
  if (spread <= 0) {
    return aim;
  }

  const first = xorshift32(seed);
  const second = xorshift32(first);
  const across = unitFrom(first) * spread;
  const up = unitFrom(second) * spread;

  // The axis the aim leans on least, so the cross product never collapses.
  const hint: Vec3 =
    Math.abs(aim.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = normalise({
    x: aim.y * hint.z - aim.z * hint.y,
    y: aim.z * hint.x - aim.x * hint.z,
    z: aim.x * hint.y - aim.y * hint.x,
  });
  const over = {
    x: right.y * aim.z - right.z * aim.y,
    y: right.z * aim.x - right.x * aim.z,
    z: right.x * aim.y - right.y * aim.x,
  };

  return normalise({
    x: aim.x + right.x * across + over.x * up,
    y: aim.y + right.y * across + over.y * up,
    z: aim.z + right.z * across + over.z * up,
  });
}

function normalise(v: Vec3): Vec3 {
  const lengthSquared = v.x * v.x + v.y * v.y + v.z * v.z;
  if (lengthSquared <= 0) {
    return { x: 0, y: 0, z: 1 };
  }
  const length = Math.sqrt(lengthSquared);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
