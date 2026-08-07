import { describe, expect, it } from 'vitest';
import { OCCLUDERS, SPAWNS } from '../src/arena.ts';
import { bodyBounds, restingBody } from '../src/body.ts';
import type { Bounds } from '../src/bounds.ts';
import { MAX_SHOT_DISTANCE, STAND_EYE } from '../src/constants.ts';
import { rayVsBox, traceShot, type ShotTarget } from '../src/ray.ts';
import { normalizeAim, type Vec3 } from '../src/vector.ts';

/** A unit cube sitting between 1 and 2 on every axis. */
const CUBE: Bounds = { minX: 1, minY: 1, minZ: 1, maxX: 2, maxY: 2, maxZ: 2 };

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

describe('a ray against a box', () => {
  it('finds the near face of a box straight ahead', () => {
    expect(rayVsBox(at(1.5, 1.5, -3), at(0, 0, 1), CUBE, 100)).toBeCloseTo(4, 12);
  });

  it('misses a box beside it', () => {
    expect(rayVsBox(at(5, 1.5, -3), at(0, 0, 1), CUBE, 100)).toBeNull();
  });

  it('misses a box behind it', () => {
    expect(rayVsBox(at(1.5, 1.5, 5), at(0, 0, 1), CUBE, 100)).toBeNull();
  });

  it('stops looking at the range it was given', () => {
    expect(rayVsBox(at(1.5, 1.5, -3), at(0, 0, 1), CUBE, 100)).not.toBeNull();
    expect(rayVsBox(at(1.5, 1.5, -3), at(0, 0, 1), CUBE, 3)).toBeNull();
  });

  it('enters at zero when it starts inside', () => {
    expect(rayVsBox(at(1.5, 1.5, 1.5), at(0, 0, 1), CUBE, 100)).toBe(0);
  });

  /*
   * The degenerate axes. Written as a division by the direction, a ray running
   * parallel to a face produces an infinity, and one that also starts on that
   * face's plane produces `0 × ∞ = NaN`. Go and TypeScript do not agree about
   * how a NaN travels through the comparisons that follow, so every one of
   * these is a case where the two implementations could silently part company.
   */
  describe('running parallel to a face', () => {
    it('hits when it is level with the box', () => {
      expect(rayVsBox(at(-3, 1.5, 1.5), at(1, 0, 0), CUBE, 100)).toBeCloseTo(4, 12);
    });

    it('misses when it is not', () => {
      expect(rayVsBox(at(-3, 9, 1.5), at(1, 0, 0), CUBE, 100)).toBeNull();
    });

    it('answers on the face plane itself rather than producing a nonsense', () => {
      // Exactly on the boundary on two axes at once, travelling along the
      // third: the case that makes the naive form produce NaN.
      const grazing = rayVsBox(at(-3, 1, 1), at(1, 0, 0), CUBE, 100);

      expect(grazing).not.toBeNull();
      expect(Number.isNaN(grazing ?? Number.NaN)).toBe(false);
      expect(grazing).toBeCloseTo(4, 12);
    });

    it('is not confused by a ray with no direction at all', () => {
      // `normalizeAim` refuses to produce this, and the rules only ever call
      // the ray with a normalised aim — but a zero vector reaching here would
      // divide its way to infinities on all three axes at once, so the branch
      // is worth holding still.
      const nowhere = rayVsBox(at(-3, 1.5, 1.5), at(0, 0, 0), CUBE, 100);

      expect(nowhere).toBeNull();
    });
  });

  it('is not fooled by a negative direction', () => {
    expect(rayVsBox(at(1.5, 1.5, 6), at(0, 0, -1), CUBE, 100)).toBeCloseTo(4, 12);
  });
});

/** A body's whole box as one target, which is enough for the tests below. */
function wholeBody(seat: 'north' | 'south', bounds: Bounds): ShotTarget {
  return {
    seat,
    part: 'torso',
    box: {
      centre: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
        z: (bounds.minZ + bounds.maxZ) / 2,
      },
      half: {
        x: (bounds.maxX - bounds.minX) / 2,
        y: (bounds.maxY - bounds.minY) / 2,
        z: (bounds.maxZ - bounds.minZ) / 2,
      },
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
    },
  };
}

describe('firing a shot', () => {
  const southEye = { ...SPAWNS.south, y: SPAWNS.south.y + STAND_EYE };
  const northBody = restingBody(SPAWNS.north);

  it('reaches the opponent across the gap', () => {
    // Both stand at their spawns, at the same height, looking at each other.
    // Nothing in the ravine may stop this, which is the whole layout.
    const aim = normalizeAim({
      x: 0,
      y: 0,
      z: SPAWNS.north.z - SPAWNS.south.z,
    });

    const trace = traceShot(southEye, aim, [wholeBody('north', bodyBounds(northBody))]);

    expect(trace.hitSeat).toBe('north');
  });

  it('stops at a wall rather than at the target behind it', () => {
    const trace = traceShot(southEye, normalizeAim({ x: 0, y: 0, z: 1 }), [
      wholeBody('north', bodyBounds(northBody)),
    ]);

    // Fired the other way: into the back wall, with the target nowhere near.
    expect(trace.hitSeat).toBeNull();
    expect(trace.distance).toBeLessThan(MAX_SHOT_DISTANCE);
  });

  it('lets a wall win a tie against a body directly behind it', () => {
    const wall = OCCLUDERS[0];
    expect(wall).toBeDefined();
    const wallFront = (wall?.minZ ?? 0) - 1;

    // A body pressed against the far side of the first occluder.
    const behind: Bounds = {
      minX: -0.4,
      minY: 0,
      minZ: wall?.maxZ ?? 0,
      maxX: 0.4,
      maxY: 1.8,
      maxZ: (wall?.maxZ ?? 0) + 0.8,
    };
    const origin = at(0, 0.5, wallFront);

    const trace = traceShot(origin, at(0, 0, 1), [wholeBody('north', behind)]);

    expect(trace.hitSeat).toBeNull();
  });

  it('travels its full range when it finds nothing', () => {
    // Straight up, out of the open top of the arena.
    const trace = traceShot(southEye, at(0, 1, 0), []);

    expect(trace.hitSeat).toBeNull();
    expect(trace.distance).toBe(MAX_SHOT_DISTANCE);
    expect(trace.endpoint.y).toBeCloseTo(southEye.y + MAX_SHOT_DISTANCE, 9);
  });

  it('reports where it stopped, on the line it was fired along', () => {
    const aim = normalizeAim({ x: 0.3, y: -0.1, z: 1 });
    const trace = traceShot(southEye, aim, []);

    expect(trace.endpoint.x).toBeCloseTo(southEye.x + aim.x * trace.distance, 9);
    expect(trace.endpoint.y).toBeCloseTo(southEye.y + aim.y * trace.distance, 9);
    expect(trace.endpoint.z).toBeCloseTo(southEye.z + aim.z * trace.distance, 9);
  });
});
