import { describe, expect, it } from 'vitest';
import { SPAWNS } from '../src/arena.ts';
import { restingBody, stepBody, type PlayerBody } from '../src/body.ts';
import {
  SPREAD_AIRBORNE,
  SPREAD_BASE,
  SPREAD_MOVING,
  SPREAD_SCOPED_SHARE,
} from '../src/constants.ts';
import { deflect, seedOf, spreadOf, unitFrom, xorshift32 } from '../src/spread.ts';
import type { Vec3 } from '../src/vector.ts';

const STILL: PlayerBody = { ...restingBody(SPAWNS.south), grounded: true };
const AIM: Vec3 = { x: 0, y: 0, z: -1 };

/** How far off the aim a deflected line ends up, at one metre. */
function offset(line: Vec3, aim: Vec3): number {
  const dot = line.x * aim.x + line.y * aim.y + line.z * aim.z;
  return Math.hypot(line.x - aim.x * dot, line.y - aim.y * dot, line.z - aim.z * dot);
}

describe('the randomness', () => {
  it('stays inside thirty-two bits, which is what makes it portable', () => {
    // The Go port does this with plain uint32 arithmetic. If JavaScript ever
    // let one of these become a double the two would part company silently.
    let state = 12345;
    for (let step = 0; step < 500; step += 1) {
      state = xorshift32(state);
      expect(Number.isInteger(state)).toBe(true);
      expect(state).toBeGreaterThanOrEqual(0);
      expect(state).toBeLessThan(2 ** 32);
    }
  });

  it('never gets stuck, even seeded with nothing', () => {
    // Zero is a fixed point of a plain xorshift, and every shot seeded to it
    // would land dead centre.
    expect(xorshift32(0)).not.toBe(0);
    expect(xorshift32(xorshift32(0))).not.toBe(xorshift32(0));
  });

  it('maps onto minus one to one without rounding', () => {
    // A power of two, so the division is exact in both languages.
    expect(unitFrom(0)).toBe(-1);
    expect(unitFrom(2147483648)).toBe(0);
    expect(unitFrom(4294967295)).toBeCloseTo(1, 8);
    expect(unitFrom(4294967295)).toBeLessThan(1);
  });

  it('gives every shot its own seed, and the same one twice', () => {
    expect(seedOf(41, 0)).toBe(seedOf(41, 0));
    expect(seedOf(41, 0)).not.toBe(seedOf(41, 1));
    expect(seedOf(41, 0)).not.toBe(seedOf(42, 0));
    // Consecutive ids must not produce neighbouring seeds, or consecutive shots
    // would stray in almost the same direction.
    expect(Math.abs(seedOf(41, 0) - seedOf(42, 0))).toBeGreaterThan(1000);
  });
});

describe('how wide a shot may stray', () => {
  it('is smallest standing still, unscoped', () => {
    expect(spreadOf(STILL, AIM, AIM, false)).toBe(SPREAD_BASE);
  });

  it('grows with the size of the step being taken', () => {
    const walking = { ...STILL, gaitPower: 1 };
    expect(spreadOf(walking, AIM, AIM, false)).toBeCloseTo(SPREAD_BASE + SPREAD_MOVING, 12);
    // Half a step costs half as much, with no rule of its own for crouching.
    const half = { ...STILL, gaitPower: 0.5 };
    expect(spreadOf(half, AIM, AIM, false)).toBeCloseTo(SPREAD_BASE + SPREAD_MOVING / 2, 12);
  });

  it('grows again in mid-air, where nobody can brace', () => {
    const jumping = { ...STILL, grounded: false };
    expect(spreadOf(jumping, AIM, AIM, false)).toBeCloseTo(SPREAD_BASE + SPREAD_AIRBORNE, 12);
  });

  it('punishes firing in the middle of a flick', () => {
    const swung = { x: 0.3, y: 0, z: -0.954 };
    expect(spreadOf(STILL, swung, AIM, false)).toBeGreaterThan(
      spreadOf(STILL, AIM, AIM, false) * 3,
    );
  });

  it('nearly disappears down the sights, but not entirely', () => {
    const scoped = spreadOf(STILL, AIM, AIM, true);
    expect(scoped).toBeCloseTo(SPREAD_BASE * SPREAD_SCOPED_SHARE, 12);
    expect(scoped).toBeGreaterThan(0);
  });

  it('tightens on its own when a player stops, with nothing to reset it', () => {
    // No accumulator: every term is read from the body, so standing still is
    // enough and there is no cooldown to wait out.
    let body: PlayerBody = STILL;
    const running = { move: { x: 1, z: 0 }, jump: false, crouch: false };
    for (let tick = 0; tick < 40; tick += 1) {
      body = stepBody(body, running);
    }
    const moving = spreadOf(body, AIM, AIM, false);
    for (let tick = 0; tick < 30; tick += 1) {
      body = stepBody(body, { move: { x: 0, z: 0 }, jump: false, crouch: false });
    }
    expect(spreadOf(body, AIM, AIM, false)).toBeLessThan(moving);
    expect(spreadOf(body, AIM, AIM, false)).toBe(SPREAD_BASE);
  });
});

describe('deflecting the aim', () => {
  it('leaves it exactly alone when there is no spread', () => {
    expect(deflect(AIM, 0, 1234)).toEqual(AIM);
  });

  it('keeps the line a unit vector, whatever it does to it', () => {
    for (let shot = 1; shot < 60; shot += 1) {
      const line = deflect(AIM, 0.05, seedOf(shot, shot % 2));
      expect(Math.hypot(line.x, line.y, line.z)).toBeCloseTo(1, 12);
    }
  });

  it('stays inside the spread it was given', () => {
    for (let shot = 1; shot < 200; shot += 1) {
      const line = deflect(AIM, 0.04, seedOf(shot, 0));
      // Two offsets at right angles, so the worst case is the diagonal.
      expect(offset(line, AIM)).toBeLessThanOrEqual(0.04 * Math.SQRT2 + 1e-9);
    }
  });

  it('scatters in every direction rather than along one line', () => {
    // One random offset would put every shot on a single axis, which reads as a
    // rifle with a bent sight rather than as a rifle held by a person.
    let up = 0;
    let down = 0;
    let left = 0;
    let right = 0;
    for (let shot = 1; shot < 200; shot += 1) {
      const line = deflect(AIM, 0.05, seedOf(shot, 0));
      if (line.y > AIM.y) up += 1;
      else down += 1;
      if (line.x > AIM.x) right += 1;
      else left += 1;
    }
    for (const count of [up, down, left, right]) {
      expect(count).toBeGreaterThan(60);
    }
  });

  it('gives the same shot the same line every time it is asked', () => {
    // The whole reason it is seeded rather than random: the server and the
    // reference implementation resolve the same shot the same way.
    const once = deflect(AIM, 0.03, seedOf(77, 1));
    const twice = deflect(AIM, 0.03, seedOf(77, 1));
    expect(twice).toEqual(once);
  });

  it('survives an aim pointing straight up, where a naive basis collapses', () => {
    const up: Vec3 = { x: 0, y: 1, z: 0 };
    const line = deflect(up, 0.05, seedOf(9, 0));
    expect(Number.isNaN(line.x)).toBe(false);
    expect(Math.hypot(line.x, line.y, line.z)).toBeCloseTo(1, 12);
  });

  it('strays further the wider the spread', () => {
    const tight = offset(deflect(AIM, 0.005, seedOf(5, 0)), AIM);
    const wide = offset(deflect(AIM, 0.05, seedOf(5, 0)), AIM);
    expect(wide).toBeGreaterThan(tight * 8);
  });
});
