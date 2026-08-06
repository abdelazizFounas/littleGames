import { describe, expect, it } from 'vitest';
import { ARENA_BOXES, COLLIDERS, SPAWNS } from '../src/arena.ts';
import { bodyBounds, restingBody, stepBody, type MoveIntent, type PlayerBody } from '../src/body.ts';
import { overlaps } from '../src/bounds.ts';
import {
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  JUMP_SPEED,
  MOVE_SPEED,
  PLAYER_HALF,
  STAND_HEIGHT,
  TICK_SECONDS,
  ZONE_NEAR_Z,
} from '../src/constants.ts';

const STILL: MoveIntent = { move: { x: 0, z: 0 }, jump: false, crouch: false };

/**
 * The near zone's awning, and a clear approach to it from behind.
 *
 * It is the only box in the arena with air underneath it, which is what makes
 * it the only place crouching is the difference between passing and not.
 */
function awningLane(): { lane: number; before: number; minZ: number; maxZ: number } {
  const found = ARENA_BOXES.find((box) => box.kind === 'wall' && box.minY > 0 && box.minZ > 0);
  if (found === undefined) {
    throw new Error('the arena has no awning to crouch under');
  }
  return {
    lane: (found.minX + found.maxX) / 2,
    before: found.maxZ + 1,
    minZ: found.minZ,
    maxZ: found.maxZ,
  };
}
const intent = (over: Partial<MoveIntent> = {}): MoveIntent => ({ ...STILL, ...over });

/** Drops a body until it is standing on something, so tests start settled. */
function settled(at: { x: number; y: number; z: number }): PlayerBody {
  let body = restingBody(at);
  for (let tick = 0; tick < 120 && !body.grounded; tick += 1) {
    body = stepBody(body, STILL);
  }
  return body;
}

function run(body: PlayerBody, ticks: number, move: MoveIntent): PlayerBody {
  let current = body;
  for (let tick = 0; tick < ticks; tick += 1) {
    current = stepBody(current, move);
  }
  return current;
}

describe('standing on the ground', () => {
  it('falls until it lands, then stays', () => {
    const spawned = restingBody({ ...SPAWNS.south, y: 3 });

    const landed = run(spawned, 120, STILL);

    expect(landed.y).toBe(0);
    expect(landed.grounded).toBe(true);
    expect(landed.vy).toBe(0);
  });

  it('never sinks into anything it is standing on', () => {
    const body = run(settled(SPAWNS.south), 60, STILL);

    for (const collider of COLLIDERS) {
      expect(overlaps(bodyBounds(body), collider)).toBe(false);
    }
  });
});

describe('walking', () => {
  it('covers one tick of speed in one tick', () => {
    const start = settled(SPAWNS.south);

    const after = stepBody(start, intent({ move: { x: 1, z: 0 } }));

    expect(after.x - start.x).toBeCloseTo(MOVE_SPEED * TICK_SECONDS, 12);
  });

  it('is slower crouched', () => {
    const start = { ...settled(SPAWNS.south), crouching: true };

    const after = stepBody(start, intent({ move: { x: 1, z: 0 }, crouch: true }));

    expect(after.x - start.x).toBeCloseTo(CROUCH_SPEED * TICK_SECONDS, 12);
  });

  it('stops against a wall instead of passing through it', () => {
    const start = settled(SPAWNS.south);

    const after = run(start, 600, intent({ move: { x: 1, z: 0 } }));

    expect(after.x).toBeLessThan(10);
    for (const collider of COLLIDERS) {
      expect(overlaps(bodyBounds(after), collider)).toBe(false);
    }
  });

  it('slides along a wall rather than sticking to it', () => {
    // Pressed diagonally into the side wall: the blocked axis stops and the
    // free one keeps going. Resolving both axes together would stop both.
    const start = settled({ x: 9, y: 0, z: SPAWNS.south.z });

    const after = run(start, 30, intent({ move: { x: Math.SQRT1_2, z: -Math.SQRT1_2 } }));

    // Stopped exactly against the wall's inner face on the blocked axis...
    expect(after.x).toBeCloseTo(10 - PLAYER_HALF, 9);
    // ...and still travelling on the free one.
    expect(after.z).toBeLessThan(start.z - 1);
  });

  it('cannot cross the ravine, however hard it is pushed at it', () => {
    const start = settled(SPAWNS.south);

    const walked = run(start, 900, intent({ move: { x: 0, z: -1 } }));
    const jumped = run(start, 900, intent({ move: { x: 0, z: -1 }, jump: true }));

    expect(walked.z).toBeGreaterThan(ZONE_NEAR_Z);
    expect(jumped.z).toBeGreaterThan(ZONE_NEAR_Z);
  });
});

describe('jumping', () => {
  it('rises, then falls back to where it started', () => {
    const start = settled(SPAWNS.south);

    const midair = run(start, 10, intent({ jump: true }));
    expect(midair.y).toBeGreaterThan(0.5);
    expect(midair.grounded).toBe(false);

    const landed = run(midair, 120, STILL);
    expect(landed.y).toBe(0);
    expect(landed.grounded).toBe(true);
  });

  it('reaches high enough to land on a crate', () => {
    let body = settled(SPAWNS.south);
    let apex = 0;
    for (let tick = 0; tick < 60; tick += 1) {
      body = stepBody(body, intent({ jump: tick === 0 }));
      apex = Math.max(apex, body.y);
    }

    // The crates stand one metre tall. The closed-form apex is a little over
    // 1.27 m; integrating a tick at a time gives slightly less, and it is the
    // integration the game actually runs.
    expect(apex).toBeGreaterThan(1.15);
    expect(apex).toBeLessThan((JUMP_SPEED * JUMP_SPEED) / 44);
  });

  it('lands on top of a crate and stays there', () => {
    const crate = ARENA_BOXES.find((box) => box.kind === 'crate' && box.minZ > 0);
    expect(crate).toBeDefined();
    const middleX = ((crate?.minX ?? 0) + (crate?.maxX ?? 0)) / 2;
    const middleZ = ((crate?.minZ ?? 0) + (crate?.maxZ ?? 0)) / 2;

    const landed = run(restingBody({ x: middleX, y: 3, z: middleZ }), 120, STILL);

    expect(landed.y).toBeCloseTo(crate?.maxY ?? 0, 9);
    expect(landed.grounded).toBe(true);
  });
});

describe('crouching', () => {
  it('shrinks the body it is hit through', () => {
    const standing = settled(SPAWNS.south);
    const crouched = stepBody(standing, intent({ crouch: true }));

    expect(bodyBounds(standing).maxY - standing.y).toBeCloseTo(STAND_HEIGHT, 12);
    expect(bodyBounds(crouched).maxY - crouched.y).toBeCloseTo(CROUCH_HEIGHT, 12);
  });

  it('gets under an awning a standing body cannot pass', () => {
    const { lane, before, minZ, maxZ } = awningLane();
    const start = settled({ x: lane, y: 0, z: before });
    const towards = intent({ move: { x: 0, z: -1 } });

    const standing = run(start, 240, towards);
    const crouching = run(start, 240, { ...towards, crouch: true });

    // Stopped dead against the near face of the awning...
    expect(standing.z).toBeGreaterThan(maxZ);
    // ...where a crouched body walks under it and out the far side.
    expect(crouching.z).toBeLessThan(minZ);
  });

  it('stays down while there is no room to stand up', () => {
    const { lane, before, minZ, maxZ } = awningLane();
    const start = settled({ x: lane, y: 0, z: before });

    const beneath = run(start, 60, intent({ move: { x: 0, z: -1 }, crouch: true }));
    expect(beneath.z).toBeLessThan(maxZ);
    expect(beneath.z).toBeGreaterThan(minZ);

    // The key is released, and it makes no difference: standing up here would
    // put a head through the awning.
    const released = run(beneath, 60, STILL);
    expect(released.crouching).toBe(true);

    // Walk back out from under it, and it stands up of its own accord.
    const clear = run(released, 240, intent({ move: { x: 0, z: 1 } }));
    expect(clear.crouching).toBe(false);
  });
});

describe('the step is small enough that nothing is ever jumped over', () => {
  it('moves less in one tick than the thinnest box is deep', () => {
    const thinnest = Math.min(
      ...COLLIDERS.flatMap((box) => [
        box.maxX - box.minX,
        box.maxY - box.minY,
        box.maxZ - box.minZ,
      ]),
    );

    expect(MOVE_SPEED * TICK_SECONDS).toBeLessThan(thinnest);
    expect(JUMP_SPEED * TICK_SECONDS).toBeLessThan(thinnest);
  });
});
