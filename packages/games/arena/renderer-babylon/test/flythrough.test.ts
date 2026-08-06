import { ARENA_BOXES, HALF_WIDTH, ZONE_FAR_Z } from '@littlegames/arena-logic';
import { describe, expect, it } from 'vitest';
import { FLYTHROUGH_PERIOD_SECONDS, flythroughAt } from '../src/flythrough.ts';

/**
 * The debug camera is the only thing that moves in this phase, so it is the
 * only thing there is to test moving. A flythrough that passed through a crate
 * would read as a fault in the renderer rather than in the camera, which is
 * exactly the sort of confusion worth spending a test to avoid.
 */

const SAMPLES = 2000;

function samples(): ReturnType<typeof flythroughAt>[] {
  return Array.from({ length: SAMPLES }, (_unused, index) =>
    flythroughAt((index / SAMPLES) * FLYTHROUGH_PERIOD_SECONDS),
  );
}

describe('the flythrough', () => {
  it('never flies through anything that is drawn', () => {
    const visible = ARENA_BOXES.filter((box) => box.visible);
    // A margin, because passing a hair outside a wall still fills the screen
    // with the inside of it.
    const margin = 0.3;

    for (const camera of samples()) {
      for (const box of visible) {
        const inside =
          camera.position.x > box.minX - margin &&
          camera.position.x < box.maxX + margin &&
          camera.position.y > box.minY - margin &&
          camera.position.y < box.maxY + margin &&
          camera.position.z > box.minZ - margin &&
          camera.position.z < box.maxZ + margin;
        expect(inside).toBe(false);
      }
    }
  });

  it('comes inside the arena rather than only circling it', () => {
    // An orbit that never enters shows the walls and nothing they contain,
    // which is the half of the arena worth looking at.
    const inside = samples().filter(
      (camera) =>
        Math.abs(camera.position.x) < HALF_WIDTH &&
        Math.abs(camera.position.z) < ZONE_FAR_Z &&
        camera.position.y < 5,
    );
    expect(inside.length).toBeGreaterThan(SAMPLES / 10);
  });

  it('always looks at the arena, on a unit vector', () => {
    for (const camera of samples()) {
      const { forward } = camera;
      const length = Math.hypot(forward.x, forward.y, forward.z);
      expect(length).toBeCloseTo(1, 12);
      // The middle of the arena is always ahead, never behind: the camera
      // orbits what it is showing.
      const towardsCentre =
        forward.x * -camera.position.x +
        forward.y * (1 - camera.position.y) +
        forward.z * -camera.position.z;
      expect(towardsCentre).toBeGreaterThan(0);
    }
  });

  it('closes the loop, so it can be played on repeat', () => {
    const start = flythroughAt(0);
    const wrapped = flythroughAt(FLYTHROUGH_PERIOD_SECONDS);
    expect(wrapped.position.x).toBeCloseTo(start.position.x, 9);
    expect(wrapped.position.y).toBeCloseTo(start.position.y, 9);
    expect(wrapped.position.z).toBeCloseTo(start.position.z, 9);
  });

  it('stays above the floor it is looking at', () => {
    for (const camera of samples()) {
      expect(camera.position.y).toBeGreaterThan(0.5);
    }
  });
});
