import { ARENA_BOXES, type Box } from '@littlegames/arena-logic';
import { colourOf, type Rgb } from './palette.ts';

/**
 * The arena, turned from rules into things to draw.
 *
 * Every box becomes one instance of a single unit cube, placed and stretched to
 * fit. Nothing here invents geometry: the numbers come from the same array the
 * server resolves collisions against, so the box that stops a bullet is the box
 * that gets drawn. That is the reason the arena lives in the logic package and
 * not in this one.
 *
 * It is also pure, which is why it is a separate file from the engine: the
 * bridge between rules and pixels is exactly the part worth testing, and it can
 * be tested without a GPU.
 */

export interface BoxInstance {
  /** Centre of the box in world metres. */
  readonly centre: { readonly x: number; readonly y: number; readonly z: number };
  /** How far the unit cube is stretched along each axis. */
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  readonly colour: Rgb;
}

export function instanceOf(box: Box): BoxInstance {
  return {
    centre: {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
      z: (box.minZ + box.maxZ) / 2,
    },
    size: {
      x: box.maxX - box.minX,
      y: box.maxY - box.minY,
      z: box.maxZ - box.minZ,
    },
    colour: colourOf(box.kind),
  };
}

/**
 * Everything the renderer draws of the arena itself.
 *
 * The invisible boxes are dropped here rather than in the engine, so "invisible"
 * means the same thing to the renderer as it does to the rules: the clip over
 * each ravine edge stops a player, and a wall you can see across is not one.
 */
export const ARENA_INSTANCES: readonly BoxInstance[] = ARENA_BOXES.filter(
  (box) => box.visible,
).map(instanceOf);
