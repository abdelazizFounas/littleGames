/**
 * An axis-aligned box.
 *
 * Everything in this game is one: the arena is boxes, and so is the player. It
 * is what the voxel look already implied, and it is worth stating as a choice
 * rather than an accident — a capsule or a cylinder would put square roots and
 * penetration depths into collision, where a box needs only comparisons.
 */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/**
 * Whether two boxes share any volume.
 *
 * Strictly, so two boxes that merely touch are not overlapping. Collision
 * resolution places a body exactly against a face, and a touching body that
 * counted as overlapping would be pushed again on the next tick, and the tick
 * after that.
 */
export function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minY < b.maxY &&
    a.maxY > b.minY &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}
