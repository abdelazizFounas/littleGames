import { ARENA_BOXES, COLLIDERS, overlaps } from '@littlegames/arena-logic';
import { describe, expect, it } from 'vitest';
import { ARENA_INSTANCES, instanceOf } from '../src/instances.ts';
import { colourOf } from '../src/palette.ts';

/**
 * The bridge between the rules and the pixels.
 *
 * The claim the whole arena rests on is that the box which stops a bullet is
 * the box that gets drawn. That claim is made here, in the conversion from a
 * box to a placed and stretched cube, so it is checked here too.
 */

/** The box an instance actually occupies once the unit cube has been stretched. */
function drawnBounds(instance: (typeof ARENA_INSTANCES)[number]) {
  return {
    minX: instance.centre.x - instance.size.x / 2,
    minY: instance.centre.y - instance.size.y / 2,
    minZ: instance.centre.z - instance.size.z / 2,
    maxX: instance.centre.x + instance.size.x / 2,
    maxY: instance.centre.y + instance.size.y / 2,
    maxZ: instance.centre.z + instance.size.z / 2,
  };
}

describe('the arena, as instances', () => {
  it('draws every box exactly where the rules put it', () => {
    for (const box of ARENA_BOXES) {
      const drawn = drawnBounds(instanceOf(box));
      expect(drawn.minX).toBeCloseTo(box.minX, 12);
      expect(drawn.minY).toBeCloseTo(box.minY, 12);
      expect(drawn.minZ).toBeCloseTo(box.minZ, 12);
      expect(drawn.maxX).toBeCloseTo(box.maxX, 12);
      expect(drawn.maxY).toBeCloseTo(box.maxY, 12);
      expect(drawn.maxZ).toBeCloseTo(box.maxZ, 12);
    }
  });

  it('draws what can be seen and nothing else', () => {
    const visible = ARENA_BOXES.filter((box) => box.visible);
    expect(ARENA_INSTANCES.length).toBe(visible.length);
    // The clips over the two ravine edges stop a player without being drawn,
    // which is the difference between a barrier and a wall.
    expect(ARENA_INSTANCES.length).toBeLessThan(COLLIDERS.length);
  });

  it('gives every kind its own colour, and none of them black', () => {
    const kinds = [...new Set(ARENA_BOXES.filter((box) => box.visible).map((box) => box.kind))];
    const seen = new Map<string, string>();

    for (const kind of kinds) {
      const colour = colourOf(kind);
      const key = `${String(colour.r)},${String(colour.g)},${String(colour.b)}`;
      // Two kinds sharing a colour is two things a player cannot tell apart at
      // a glance across the arena, which at speed is all the time there is.
      expect(seen.has(key)).toBe(false);
      seen.set(key, kind);
      expect(colour.r + colour.g + colour.b).toBeGreaterThan(0);
    }
  });

  it('draws no two pieces of scenery through one another', () => {
    // Overlapping boxes fight over which is in front, a tie the depth buffer
    // breaks differently from one frame to the next. It is the shimmer along a
    // seam that gives a voxel scene away as thrown together.
    const drawn = ARENA_INSTANCES.map(drawnBounds);
    for (const [index, box] of drawn.entries()) {
      for (const other of drawn.slice(index + 1)) {
        expect(overlaps(box, other)).toBe(false);
      }
    }
  });
});
