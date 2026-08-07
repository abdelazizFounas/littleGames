import { describe, expect, it } from 'vitest';
import { SPAWNS } from '../src/arena.ts';
import { restingBody, stepBody, type PlayerBody } from '../src/body.ts';
import { CROUCH_HEIGHT, STAND_HEIGHT, STRIDE_METRES } from '../src/constants.ts';
import {
  facingOf,
  hittablePartsOf,
  lift,
  poseOf,
  swing,
  type BodyPart,
  type PartBox,
} from '../src/pose.ts';

const GROUNDED: PlayerBody = { ...restingBody(SPAWNS.north), grounded: true };
const AIM = { x: 0, y: 0, z: 1 };

const STILL = { move: { x: 0, z: 0 }, jump: false, crouch: false };
const WALKING = { move: { x: 0, z: -1 }, jump: false, crouch: false };
const DUCKING = { move: { x: 0, z: 0 }, jump: false, crouch: true };

/** The parts of one pose, by name, which is how nearly every check reads them. */
function partsOf(body: PlayerBody): (name: BodyPart) => PartBox {
  const parts = new Map(poseOf(body, AIM).parts.map((part) => [part.part, part]));
  return (name) => {
    const found = parts.get(name);
    if (found === undefined) {
      throw new Error(`the pose has no ${name}`);
    }
    return found;
  };
}

/** The far end of a limb, along its own axis: knee, foot, hand. */
function endOf(part: PartBox): { x: number; y: number; z: number } {
  return {
    x: part.centre.x - part.up.x * part.half.y,
    y: part.centre.y - part.up.y * part.half.y,
    z: part.centre.z - part.up.z * part.half.y,
  };
}

/** The end a limb hangs from: the hip for a thigh, the knee for a shin. */
function jointOf(part: PartBox): { x: number; y: number; z: number } {
  return {
    x: part.centre.x + part.up.x * part.half.y,
    y: part.centre.y + part.up.y * part.half.y,
    z: part.centre.z + part.up.z * part.half.y,
  };
}

function walked(ticks: number, intent = WALKING): PlayerBody {
  let body = GROUNDED;
  for (let tick = 0; tick < ticks; tick += 1) {
    body = stepBody(body, intent);
  }
  return body;
}

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

  it('lifts one foot at a time, and never both', () => {
    // A walk where both feet leave the ground is a run at best and a hover at
    // worst. The two halves of the cycle are exclusive by construction.
    for (let phase = 0; phase < 1; phase += 0.01) {
      const other = phase < 0.5 ? phase + 0.5 : phase - 0.5;
      expect(Math.min(lift(phase), lift(other))).toBe(0);
    }
    // Highest halfway through the swing, which is when the foot passes under
    // the body.
    expect(lift(0.25)).toBe(1);
    expect(lift(0)).toBe(0);
    expect(lift(0.5)).toBe(0);
  });

  it('advances with the ground actually covered', () => {
    const before = GROUNDED.gaitPhase;
    expect(stepBody(GROUNDED, WALKING).gaitPhase).not.toBe(before);

    // One whole stride of walking returns it to where it started. Walked
    // sideways, along the open width of the zone, so the wall is never reached.
    const sideways = { move: { x: 1, z: 0 }, jump: false, crouch: false };
    let travelled = 0;
    let walking = GROUNDED;
    for (let tick = 0; tick < 200 && travelled < STRIDE_METRES; tick += 1) {
      const next = stepBody(walking, sideways);
      travelled += Math.hypot(next.x - walking.x, next.z - walking.z);
      walking = next;
    }
    expect(travelled).toBeGreaterThanOrEqual(STRIDE_METRES);
    expect(walking.gaitPhase).toBeCloseTo(GROUNDED.gaitPhase, 1);
  });

  it('stops striding for a player walking into a wall', () => {
    // Pressed against something, a body covers no ground. Legs that kept
    // striding would be running on the spot.
    const pinned = walked(200);
    const next = stepBody(pinned, WALKING);
    expect(next.z).toBeCloseTo(pinned.z, 9);
    expect(next.gaitPhase).toBe(pinned.gaitPhase);
    // Held there, the step has already shrunk to nothing and stays there.
    expect(pinned.gaitPower).toBe(0);
    expect(next.gaitPower).toBe(0);
  });

  it('takes bigger steps the faster the player is going', () => {
    // Sideways, along the open width of the zone, so neither reaches a wall and
    // the only difference between them is how fast they are going.
    const across = { move: { x: 1, z: 0 }, jump: false, crouch: false };
    const running = walked(40, across);
    const crouching = walked(40, { ...across, crouch: true });
    // A crouched walk covers less ground a tick, and the step follows without
    // any rule of its own.
    expect(crouching.gaitPower).toBeGreaterThan(0);
    expect(crouching.gaitPower).toBeLessThan(running.gaitPower);
    expect(running.gaitPower).toBe(1);
  });

  it('puts the step away when the player stops', () => {
    let body = walked(12);
    expect(body.gaitPower).toBeGreaterThan(0);
    for (let tick = 0; tick < 30; tick += 1) {
      body = stepBody(body, STILL);
    }
    // Standing still means standing, not frozen mid-step.
    expect(body.gaitPower).toBe(0);
  });

  it('holds the stride through a jump rather than running in mid-air', () => {
    const body = walked(8);
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
  it('builds a right-handed frame with no trigonometry in it', () => {
    const pose = poseOf(GROUNDED, AIM);
    expect(Math.hypot(pose.forward.x, pose.forward.z)).toBeCloseTo(1, 12);
    // Perpendicular, and a quarter turn is a swap and a sign.
    expect(pose.forward.x * pose.right.x + pose.forward.z * pose.right.z).toBeCloseTo(0, 12);
    expect(pose.right).toEqual({ x: AIM.z, y: 0, z: -AIM.x });
  });

  it('keeps every part of the body inside the box that can be hit', () => {
    // The rifle is deliberately not among these: it is held out in front, and
    // it is not something a bullet stops against.
    for (const crouchAmount of [0, 0.5, 1]) {
      const body = { ...GROUNDED, crouching: crouchAmount === 1, crouchAmount, gaitPower: 1 };
      const height = STAND_HEIGHT + (CROUCH_HEIGHT - STAND_HEIGHT) * crouchAmount;
      for (const part of hittablePartsOf(poseOf(body, AIM))) {
        const reach =
          Math.abs(part.up.y) * part.half.y +
          Math.abs(part.forward.y) * part.half.z +
          Math.abs(part.right.y) * part.half.x;
        // A tenth of a metre of slack, because `reach` is the corner of the
        // box rather than its face: a shin tilted at the end of a stride puts
        // one bottom corner a few centimetres under the floor, which nothing
        // can see and nothing can exploit.
        expect(part.centre.y - reach).toBeGreaterThanOrEqual(body.y - 0.1);
        expect(part.centre.y + reach).toBeLessThanOrEqual(body.y + height + 0.06);
      }
    }
  });

  it('stacks head over torso over legs', () => {
    const parts = partsOf(GROUNDED);
    expect(parts('head').centre.y).toBeGreaterThan(parts('torso').centre.y ?? 0);
    expect(parts('torso').centre.y).toBeGreaterThan(parts('thighLeft').centre.y ?? 0);
    expect(parts('thighLeft').centre.y).toBeGreaterThan(parts('shinLeft').centre.y ?? 0);
  });

  it('joins hip to knee to foot with no gaps in between', () => {
    // A leg drawn as two boxes that do not meet is a leg with a hole in it, and
    // once these are hitboxes it is a hole a bullet goes through.
    for (const body of [GROUNDED, walked(9), { ...GROUNDED, crouching: true, crouchAmount: 1 }]) {
      const parts = partsOf(body);
      for (const side of ['Left', 'Right'] as const) {
        const thigh = parts(`thigh${side}`);
        const shin = parts(`shin${side}`);
        const knee = endOf(thigh);
        const top = jointOf(shin);
        expect(Math.hypot(knee.x - top.x, knee.y - top.y, knee.z - top.z)).toBeLessThan(0.001);
      }
    }
  });

  it('stands the feet on the ground and keeps them there', () => {
    for (const body of [GROUNDED, { ...GROUNDED, crouching: true, crouchAmount: 1 }]) {
      const parts = partsOf(body);
      for (const side of ['Left', 'Right'] as const) {
        // The sole rests on the ground, so the ankle sits a boot's height above
        // it rather than the leg ending inside the floor.
        const foot = endOf(parts(`shin${side}`));
        expect(foot.y - body.y).toBeGreaterThan(0);
        expect(foot.y - body.y).toBeLessThan(0.12);
      }
    }
  });

  it('bends the knee forward rather than backwards', () => {
    // Facing +z, so a knee in front of the line from hip to foot is at a
    // greater z than both. A knee behind it is a leg that bends the wrong way.
    const parts = partsOf({ ...GROUNDED, crouching: true, crouchAmount: 1 });
    const thigh = parts('thighRight');
    const knee = endOf(thigh);
    const hip = jointOf(thigh);
    const foot = endOf(parts('shinRight'));
    expect(knee.z).toBeGreaterThan(hip.z + 0.1);
    expect(knee.z).toBeGreaterThan(foot.z + 0.1);
  });

  it('straightens the legs and closes the feet when nobody is moving', () => {
    const parts = partsOf(GROUNDED);
    const left = parts('shinLeft');
    const right = parts('shinRight');
    // Same place fore and aft, and neither foot off the ground.
    expect(endOf(left).z).toBeCloseTo(endOf(right).z, 9);
    expect(endOf(left).y).toBeCloseTo(endOf(right).y, 9);
    // And nearly straight down: a standing leg carries only a soft bend.
    expect(right.up.y).toBeGreaterThan(0.97);
  });

  it('swings the legs apart while walking, one leading and one trailing', () => {
    let apart = 0;
    let body = GROUNDED;
    for (let tick = 0; tick < 60; tick += 1) {
      body = stepBody(body, { move: { x: 1, z: 0 }, jump: false, crouch: false });
      const parts = partsOf(body);
      const left = endOf(parts('shinLeft'));
      const right = endOf(parts('shinRight'));
      apart = Math.max(apart, Math.abs(left.z - right.z));
    }
    // Well over half a metre between the feet at the ends of a full stride.
    expect(apart).toBeGreaterThan(0.5);
  });

  it('lifts the swinging foot off the ground', () => {
    let highest = 0;
    let body = GROUNDED;
    for (let tick = 0; tick < 60; tick += 1) {
      body = stepBody(body, { move: { x: 1, z: 0 }, jump: false, crouch: false });
      const parts = partsOf(body);
      highest = Math.max(
        highest,
        endOf(parts('shinLeft')).y - body.y,
        endOf(parts('shinRight')).y - body.y,
      );
    }
    expect(highest).toBeGreaterThan(0.05);
  });

  it('folds into a crouch rather than sinking into the floor', () => {
    const standing = partsOf(GROUNDED);
    const crouched = partsOf({ ...GROUNDED, crouching: true, crouchAmount: 1 });

    // Everything comes down, and the hips come down by most of their standing
    // height — a body on a lift would drop head and hips by the same amount and
    // leave the legs the same length.
    const hipDrop =
      jointOf(standing('thighRight')).y -
      jointOf(crouched('thighRight')).y;
    expect(crouched('head').centre.y).toBeLessThan(standing('head').centre.y ?? 0);
    expect(hipDrop).toBeGreaterThan(0.4);

    // And the torso tips forward rather than staying bolt upright.
    expect(crouched('torso').up.z).toBeGreaterThan(0.3);
    expect(standing('torso').up.y).toBeCloseTo(1, 9);
  });

  it('keeps a crouched head over the feet rather than out in front of them', () => {
    // The knees go forward and the seat goes back. If only one of those
    // happened the figure would be lunging, and half of it would be outside the
    // box it is allowed to occupy.
    const crouched = partsOf({ ...GROUNDED, crouching: true, crouchAmount: 1 });
    const head = crouched('head');
    expect(Math.abs(head.centre.z - GROUNDED.z)).toBeLessThan(0.4);
  });

  it('moves through the crouch rather than jumping between two poses', () => {
    let body: PlayerBody = GROUNDED;
    let previous = partsOf(body)('head');
    let steps = 0;
    for (let tick = 0; tick < 12 && body.crouchAmount < 1; tick += 1) {
      body = stepBody(body, DUCKING);
      const head = partsOf(body)('head');
      // No single tick may move the head more than a fifth of the whole drop.
      expect(previous.centre.y - head.centre.y).toBeLessThan(0.2);
      previous = head;
      steps += 1;
    }
    expect(steps).toBeGreaterThan(4);
  });

  it('turns with the body', () => {
    const north = poseOf(GROUNDED, { x: 0, y: 0, z: 1 });
    const east = poseOf(GROUNDED, { x: 1, y: 0, z: 0 });
    const muzzleNorth = north.muzzle;
    const muzzleEast = east.muzzle;
    expect(muzzleNorth.z).toBeGreaterThan(GROUNDED.z);
    expect(muzzleEast.x).toBeGreaterThan(GROUNDED.x);
  });
});

describe('the rifle', () => {
  it('is held out in front, in the hands, at chest height', () => {
    const parts = partsOf(GROUNDED);
    const barrel = parts('weapon');
    expect(barrel.centre.z).toBeGreaterThan(GROUNDED.z);
    expect(barrel.centre.y).toBeGreaterThan(GROUNDED.y + 1);
    // Longer than it is wide, which is what makes it read as a rifle.
    expect(barrel.half.z).toBeGreaterThan(barrel.half.x * 4);
  });

  it('has both hands on it rather than arms hanging at the sides', () => {
    const parts = partsOf(GROUNDED);
    const barrel = parts('weapon');
    for (const name of ['armLeft', 'armRight'] as const) {
      const hand = endOf(parts(name));
      // Within a hand's width of the weapon's own axis, which is what holding
      // it means.
      const toHand = {
        x: hand.x - barrel.centre.x,
        y: hand.y - barrel.centre.y,
        z: hand.z - barrel.centre.z,
      };
      const along =
        toHand.x * barrel.forward.x + toHand.y * barrel.forward.y + toHand.z * barrel.forward.z;
      const off = Math.hypot(
        toHand.x - barrel.forward.x * along,
        toHand.y - barrel.forward.y * along,
        toHand.z - barrel.forward.z * along,
      );
      expect(off).toBeLessThan(0.2);
      expect(Math.abs(along)).toBeLessThan(barrel.half.z);
    }
  });

  it('points where the player aims rather than where they stand', () => {
    // Aiming upwards has to raise the barrel, or the tracer leaves the muzzle
    // in a direction the rifle is plainly not pointing.
    const level = poseOf(GROUNDED, { x: 0, y: 0, z: 1 });
    const raised = poseOf(GROUNDED, { x: 0, y: 0.7, z: 0.7 });
    expect(raised.muzzle.y).toBeGreaterThan(level.muzzle.y);
  });

  it('puts the muzzle at the far end of the barrel', () => {
    const pose = poseOf(GROUNDED, AIM);
    expect(pose.muzzle.z).toBeGreaterThan(partsOf(GROUNDED)('weapon').centre.z);
  });

  it('is not something a bullet can hit', () => {
    // A rifle that stopped bullets would make hiding behind your own gun a
    // tactic.
    const hittable = hittablePartsOf(poseOf(GROUNDED, AIM)).map((part) => part.part);
    expect(hittable).not.toContain('weapon');
    expect(hittable).not.toContain('sight');
    expect(hittable).toContain('head');
    expect(hittable).toContain('shinLeft');
  });
});
