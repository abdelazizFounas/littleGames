import { describe, expect, it } from 'vitest';
import { SPAWNS } from '../src/arena.ts';
import {
  FEET_TOGETHER_EARLY,
  FEET_TOGETHER_LATE,
  restingBody,
  stepBody,
  type PlayerBody,
} from '../src/body.ts';
import { CROUCH_HEIGHT, STAND_HEIGHT, STRIDE_METRES } from '../src/constants.ts';
import { facingOf, poseOf, swing, weaponOf } from '../src/pose.ts';

const GROUNDED: PlayerBody = { ...restingBody(SPAWNS.north), grounded: true };

/** How high a posed head sits, which is the whole figure's height in one number. */
function headHeight(pose: { parts: readonly { part: string; centre: { y: number } }[] }): number {
  return pose.parts.find((part) => part.part === 'head')?.centre.y ?? 0;
}
const STILL = { move: { x: 0, z: 0 }, jump: false, crouch: false };
const WALKING = { move: { x: 0, z: -1 }, jump: false, crouch: false };

describe('the stride', () => {
  it('is a triangle, so both languages agree on it exactly', () => {
    // A sine is not exactly rounded and the Go port has to land on the same
    // bits. A triangle is built from multiplication and comparison alone.
    expect(swing(0)).toBe(-1);
    expect(swing(0.25)).toBe(0);
    expect(swing(0.5)).toBe(1);
    expect(swing(0.75)).toBe(0);
    expect(swing(1)).toBe(-1);
    // Linear between the corners, which is what makes it exact.
    expect(swing(0.125)).toBeCloseTo(-0.5, 12);
    expect(swing(0.625)).toBeCloseTo(0.5, 12);
  });

  it('advances with the ground actually covered', () => {
    let body = GROUNDED;
    const before = body.gaitPhase;
    body = stepBody(body, WALKING);
    expect(body.gaitPhase).not.toBe(before);

    // One whole stride of walking returns it to where it started. Walked
    // sideways, along the open width of the zone, so the wall is never reached.
    const sideways = { move: { x: 1, z: 0 }, jump: false, crouch: false };
    let travelled = 0;
    let walked = GROUNDED;
    for (let tick = 0; tick < 200 && travelled < STRIDE_METRES; tick += 1) {
      const next = stepBody(walked, sideways);
      travelled += Math.hypot(next.x - walked.x, next.z - walked.z);
      walked = next;
    }
    expect(travelled).toBeGreaterThanOrEqual(STRIDE_METRES);
    expect(walked.gaitPhase).toBeCloseTo(GROUNDED.gaitPhase, 1);
  });

  it('stops striding for a player walking into a wall', () => {
    // Pressed against something, a body covers no ground. Legs that kept
    // striding would be running on the spot.
    const into = { move: { x: 0, z: -1 }, jump: false, crouch: false };
    let body = GROUNDED;
    for (let tick = 0; tick < 200; tick += 1) {
      body = stepBody(body, into);
    }

    const pinned = stepBody(body, into);
    expect(pinned.z).toBeCloseTo(body.z, 9);
    // Held there, the legs settle level instead of marching on the spot.
    expect(swing(pinned.gaitPhase)).toBe(0);
  });

  it('settles the legs level once the player stops', () => {
    let body = GROUNDED;
    for (let tick = 0; tick < 12; tick += 1) {
      body = stepBody(body, WALKING);
    }
    expect(swing(body.gaitPhase)).not.toBe(0);

    for (let tick = 0; tick < 60; tick += 1) {
      body = stepBody(body, STILL);
    }
    // Standing still means standing, not frozen mid-step.
    expect([FEET_TOGETHER_EARLY, FEET_TOGETHER_LATE]).toContain(body.gaitPhase);
    expect(swing(body.gaitPhase)).toBe(0);
  });

  it('holds the stride through a jump rather than running in mid-air', () => {
    let body = GROUNDED;
    for (let tick = 0; tick < 8; tick += 1) {
      body = stepBody(body, WALKING);
    }
    const launched = stepBody(body, { ...WALKING, jump: true });
    const midAir = stepBody(launched, WALKING);
    expect(midAir.grounded).toBe(false);
    expect(midAir.gaitPhase).toBe(launched.gaitPhase);
  });
});

describe('facing', () => {
  it('is the aim flattened, so a player looking down stays upright', () => {
    const steep = facingOf({ x: 0, y: -0.99, z: 0.1 });
    expect(steep.y).toBe(0);
    expect(Math.hypot(steep.x, steep.z)).toBeCloseTo(1, 12);
    expect(steep.z).toBeGreaterThan(0);
  });

  it('falls back to a fixed direction when the aim says nothing about it', () => {
    // Straight up carries no horizontal direction to take.
    expect(facingOf({ x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe('the pose', () => {
  const aim = { x: 0, y: 0, z: 1 };

  it('builds a right-handed frame with no trigonometry in it', () => {
    const pose = poseOf(GROUNDED, aim);
    expect(Math.hypot(pose.forward.x, pose.forward.z)).toBeCloseTo(1, 12);
    // Perpendicular, and a quarter turn is a swap and a sign.
    expect(pose.forward.x * pose.right.x + pose.forward.z * pose.right.z).toBeCloseTo(0, 12);
    expect(pose.right).toEqual({ x: aim.z, y: 0, z: -aim.x });
  });

  it('keeps every part inside the body it belongs to', () => {
    for (const crouching of [false, true]) {
      const body = { ...GROUNDED, crouching };
      const height = crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
      for (const part of poseOf(body, aim).parts) {
        expect(part.centre.y - part.half.y).toBeGreaterThanOrEqual(body.y - 0.001);
        expect(part.centre.y + part.half.y).toBeLessThanOrEqual(body.y + height + 0.001);
      }
    }
  });

  it('puts the head on top and the legs underneath', () => {
    const parts = new Map(poseOf(GROUNDED, aim).parts.map((part) => [part.part, part]));
    const head = parts.get('head');
    const torso = parts.get('torso');
    const leg = parts.get('legLeft');
    expect(head?.centre.y).toBeGreaterThan(torso?.centre.y ?? 0);
    expect(torso?.centre.y).toBeGreaterThan(leg?.centre.y ?? 0);
  });

  it('swings the legs apart and the arms against them', () => {
    const striding = { ...GROUNDED, gaitPhase: 0.5 };
    const parts = new Map(poseOf(striding, aim).parts.map((part) => [part.part, part]));
    const legLeft = parts.get('legLeft');
    const legRight = parts.get('legRight');
    const armLeft = parts.get('armLeft');

    // Facing +z, so a leg that leads is further along z than one that trails.
    expect(legLeft?.centre.z).toBeGreaterThan(legRight?.centre.z ?? 0);
    // The arm on the same side goes the other way, as arms do.
    expect(armLeft?.centre.z).toBeLessThan(legLeft?.centre.z ?? 0);
  });

  it('stands the legs level at a settled phase', () => {
    const parts = new Map(
      poseOf({ ...GROUNDED, gaitPhase: FEET_TOGETHER_EARLY }, aim).parts.map((p) => [p.part, p]),
    );
    expect(parts.get('legLeft')?.centre.z).toBeCloseTo(parts.get('legRight')?.centre.z ?? 0, 12);
  });

  it('shrinks the whole figure when crouched rather than sinking it', () => {
    const standing = poseOf(GROUNDED, aim);
    const crouched = poseOf({ ...GROUNDED, crouching: true }, aim);
    expect(headHeight(crouched)).toBeLessThan(headHeight(standing));
    for (const part of crouched.parts) {
      expect(part.centre.y).toBeGreaterThanOrEqual(GROUNDED.y);
    }
  });

  it('turns with the body', () => {
    const north = poseOf(GROUNDED, { x: 0, y: 0, z: 1 });
    const east = poseOf(GROUNDED, { x: 1, y: 0, z: 0 });
    const headNorth = north.parts.find((part) => part.part === 'head');
    const headEast = east.parts.find((part) => part.part === 'head');
    // The head leans a couple of centimetres forward, so which way is forward
    // is visible in where it ends up.
    expect(headNorth?.centre.z).not.toBeCloseTo(headEast?.centre.z ?? 0, 3);
  });
});

describe('the rifle', () => {
  it('is held out in front, on the right, at shoulder height', () => {
    const body = GROUNDED;
    const pose = poseOf(body, { x: 0, y: 0, z: 1 });
    const [barrel] = weaponOf(body, pose);

    expect(barrel?.centre.z).toBeGreaterThan(body.z);
    expect(barrel?.centre.y).toBeGreaterThan(body.y + 1);
    // Longer than it is wide, which is what makes it read as a rifle.
    expect(barrel?.half.z).toBeGreaterThan((barrel?.half.x ?? 0) * 4);
  });

  it('comes down with a crouching player', () => {
    const pose = poseOf(GROUNDED, { x: 0, y: 0, z: 1 });
    const crouched = { ...GROUNDED, crouching: true };
    const [standing] = weaponOf(GROUNDED, pose);
    const [low] = weaponOf(crouched, poseOf(crouched, { x: 0, y: 0, z: 1 }));
    expect(low?.centre.y).toBeLessThan(standing?.centre.y ?? 0);
  });
});
