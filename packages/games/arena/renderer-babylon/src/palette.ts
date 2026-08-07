import type { BodyPart, BoxKind, Seat } from '@littlegames/arena-logic';

/**
 * Every colour in the game, in one place.
 *
 * Flat, saturated and untextured, which is the whole look: a voxel arena reads
 * by the colour of a face and the shadow along an edge, so the colours have to
 * do the work a texture would otherwise do. They are kept far enough apart that
 * a crate is never mistaken for the floor at a glance across the arena, which
 * at speed is all the time anyone has.
 */

/** Red, green and blue in [0, 1], which is what the engine wants. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function rgb(hex: number): Rgb {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  };
}

const KIND_COLOURS: Readonly<Record<BoxKind, Rgb>> = {
  floor: rgb(0x454f63),
  wall: rgb(0x3b4457),
  crate: rgb(0xc8823c),
  pillar: rgb(0x59637a),
  ledge: rgb(0x8d5f8c),
  clip: rgb(0x000000),
};

/** The colour a box of this kind is drawn in. */
export function colourOf(kind: BoxKind): Rgb {
  return KIND_COLOURS[kind];
}

/** Above the walls. No texture, no gradient, no sun: the arena is the subject. */
export const SKY = rgb(0x161a22);

/** Under the arena, seen down the ravine. Darker than the sky, so down reads. */
export const VOID = rgb(0x0b0d12);

/** A shot that found nothing, and one that found somebody. */
export const TRACER = rgb(0xffe8a8);
export const TRACER_HIT = rgb(0xff6b6b);

/** One colour per seat, so a glimpse across the arena is already an answer. */
const SEAT_COLOURS: Readonly<Record<Seat, Rgb>> = {
  north: rgb(0x4aa3ff),
  south: rgb(0xff5d5d),
};

export function colourOfSeat(seat: Seat): Rgb {
  return SEAT_COLOURS[seat];
}

/** Lightens or darkens a colour, keeping it inside the range. */
function shade(colour: Rgb, factor: number): Rgb {
  return {
    r: Math.min(colour.r * factor, 1),
    g: Math.min(colour.g * factor, 1),
    b: Math.min(colour.b * factor, 1),
  };
}

/** Gunmetal. The one thing on a player that is not their team's colour. */
const WEAPON = rgb(0x2a2d34);
const SIGHT = rgb(0x14161a);

/**
 * How each part of a body is coloured, given the seat it belongs to.
 *
 * The head is lightest and the limbs darkest, which does two things: it reads
 * as a figure rather than as a heap of identical boxes, and it makes the head —
 * the part worth hitting — the easiest one to pick out at range.
 */
export function colourOfPart(part: BodyPart, seat: Rgb): Rgb {
  switch (part) {
    case 'head':
      return shade(seat, 1.45);
    case 'torso':
      return seat;
    case 'weapon':
      return WEAPON;
    case 'sight':
      return SIGHT;
    default:
      return shade(seat, 0.7);
  }
}
