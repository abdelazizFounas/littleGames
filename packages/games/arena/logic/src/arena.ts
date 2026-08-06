import {
  HALF_WIDTH,
  WALL_HEIGHT,
  WALL_THICKNESS,
  ZONE_FAR_Z,
  ZONE_NEAR_Z,
} from './constants.ts';
import type { Vec3 } from './vector.ts';

/**
 * The arena, as data.
 *
 * It lives here rather than in the renderer because the box that stops a bullet
 * has to be the box that gets drawn. The renderer imports this package and
 * draws what it finds; it never has geometry of its own, so the two cannot
 * disagree about where a wall is. The conformance vectors carry this array too,
 * and the Go port asserts its own copy matches — a crate nudged in one language
 * and not the other is the kind of divergence that would otherwise hide for
 * weeks.
 */

export type BoxKind = 'floor' | 'wall' | 'crate' | 'pillar' | 'ledge' | 'clip';

export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly kind: BoxKind;
  /** Stops a body. */
  readonly blocksMovement: boolean;
  /** Stops a bullet. */
  readonly blocksSight: boolean;
  /** Drawn at all. */
  readonly visible: boolean;
}

/**
 * Three flags rather than one `solid`, and the ravine is why.
 *
 * The barrier across the front of each zone must stop a player without stopping
 * a bullet — shooting across the gap is the entire game. A single flag cannot
 * say that.
 */
function flagsFor(kind: BoxKind): Pick<Box, 'blocksMovement' | 'blocksSight' | 'visible'> {
  return kind === 'clip'
    ? { blocksMovement: true, blocksSight: false, visible: false }
    : { blocksMovement: true, blocksSight: true, visible: true };
}

function box(
  kind: BoxKind,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Box {
  return { minX, minY, minZ, maxX, maxY, maxZ, kind, ...flagsFor(kind) };
}

/** Reflects a box across x = 0, so a zone's own left and right match. */
export function mirrorX(source: Box): Box {
  return { ...source, minX: -source.maxX, maxX: -source.minX };
}

/**
 * Reflects a box across z = 0, which is how the second zone exists at all.
 *
 * Generating the far half rather than typing it out makes the symmetry
 * structural: there is no arrangement in which one player has cover the other
 * does not, because there is only one arrangement.
 */
export function mirrorZ(source: Box): Box {
  return { ...source, minZ: -source.maxZ, maxZ: -source.minZ };
}

/** A pair of boxes either side of the arena's centre line. */
function pairX(source: Box): Box[] {
  return [source, mirrorX(source)];
}

/** How high a crate stands: low enough to jump onto, high enough to hide behind. */
const CRATE = 1;
/** Chest-high cover: crouch behind it, stand up to shoot over it. */
const LOW_WALL = 0.9;
const PILLAR_HEIGHT = 2.4;

/**
 * One player's half, at positive z.
 *
 * Order matters and is load-bearing: collision resolves against these in array
 * order, and the Go port iterates the identical sequence. Never a map — Go
 * randomises map iteration by design, and a divergence there would be silent.
 */
const NEAR_ZONE: readonly Box[] = [
  // The ground, one metre thick so a body landing on it has something to stop
  // against rather than a plane to fall through.
  box('floor', -HALF_WIDTH, -1, ZONE_NEAR_Z, HALF_WIDTH, 0, ZONE_FAR_Z),

  // The three closed sides.
  box('wall', -HALF_WIDTH, 0, ZONE_FAR_Z, HALF_WIDTH, WALL_HEIGHT, ZONE_FAR_Z + WALL_THICKNESS),
  ...pairX(
    box(
      'wall',
      HALF_WIDTH,
      0,
      ZONE_NEAR_Z,
      HALF_WIDTH + WALL_THICKNESS,
      WALL_HEIGHT,
      ZONE_FAR_Z + WALL_THICKNESS,
    ),
  ),

  // The fourth side is the ravine. A chest-high parapet you can crouch behind
  // and shoot over...
  box('ledge', -HALF_WIDTH, 0, ZONE_NEAR_Z, HALF_WIDTH, LOW_WALL, ZONE_NEAR_Z + 0.4),
  // ...and above it, nothing to see and nothing to shoot, but nothing to cross
  // either. This is the whole reason a box carries three flags instead of one.
  //
  // Both sit on the zone's own floor rather than leaning out over the drop, so
  // the gap itself holds nothing at all — which is what makes "a bullet crosses
  // it and a player never does" a property of the map rather than a hope.
  box('clip', -HALF_WIDTH, LOW_WALL, ZONE_NEAR_Z, HALF_WIDTH, WALL_HEIGHT, ZONE_NEAR_Z + 0.4),

  // Cover, mirrored about the centre line so neither flank is the good one.
  ...pairX(box('crate', 3.6, 0, ZONE_NEAR_Z + 1.4, 5.6, CRATE, ZONE_NEAR_Z + 3.4)),
  ...pairX(box('pillar', 1.2, 0, ZONE_NEAR_Z + 4.2, 2, PILLAR_HEIGHT, ZONE_NEAR_Z + 5)),
  ...pairX(box('ledge', 6.8, 0, ZONE_NEAR_Z + 5.2, HALF_WIDTH, LOW_WALL, ZONE_NEAR_Z + 5.6)),
  // An awning off each side wall, too low to stand under and high enough to
  // crouch under. Without somewhere it is the only way through, crouching is a
  // smaller hitbox and nothing else — so the lane beneath it is deliberately
  // kept clear of everything else, and it leads somewhere: the flank route to
  // the parapet.
  ...pairX(box('wall', 6.8, 1.2, ZONE_NEAR_Z + 1, HALF_WIDTH, 1.8, ZONE_NEAR_Z + 3)),
  // One crate dead centre, so the straight line between the two spawns is not a
  // free shot at the moment the round opens.
  box('crate', -1, 0, ZONE_NEAR_Z + 2.2, 1, CRATE, ZONE_NEAR_Z + 4.2),
];

/** Every box in the arena, near zone first, then its reflection. */
export const ARENA_BOXES: readonly Box[] = [...NEAR_ZONE, ...NEAR_ZONE.map(mirrorZ)];

/** What a body collides with, in the order it is tested. */
export const COLLIDERS: readonly Box[] = ARENA_BOXES.filter((candidate) => candidate.blocksMovement);

/** What a bullet stops against, in the order it is tested. */
export const OCCLUDERS: readonly Box[] = ARENA_BOXES.filter((candidate) => candidate.blocksSight);

/** Which half of the arena a player holds. */
export type Seat = 'north' | 'south';

export const SEATS: readonly Seat[] = ['north', 'south'];

export function opponentOf(seat: Seat): Seat {
  return seat === 'north' ? 'south' : 'north';
}

/** Feet position each seat returns to. At the back, facing across the gap. */
export const SPAWNS: Readonly<Record<Seat, Vec3>> = {
  south: { x: 0, y: 0, z: ZONE_FAR_Z - 1.5 },
  north: { x: 0, y: 0, z: -(ZONE_FAR_Z - 1.5) },
};

/** Which way a seat looks when it spawns: across the gap, at the other one. */
export const SPAWN_AIM: Readonly<Record<Seat, Vec3>> = {
  south: { x: 0, y: 0, z: -1 },
  north: { x: 0, y: 0, z: 1 },
};
