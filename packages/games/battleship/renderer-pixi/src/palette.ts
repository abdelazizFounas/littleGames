/**
 * Every colour the game is drawn in.
 *
 * Nothing here comes from an image file. Water, hulls, torpedoes and explosions
 * are all `Graphics` and motion, which keeps the repository free of binaries and
 * keeps the look of a piece with the sharp-edged interface around it. If sprite
 * art ever replaces them, this package is the only one that changes.
 */
export const BACKGROUND = 0x10212d;
export const FOREGROUND = 0xeef0f4;
export const MUTED = 0xa1b9c5;
export const LINE = 0x3d6678;

/** The sea, from its floor upwards. */
export const SEA_DEEP = 0x0d3042;
export const SEA_WAVE_LOW = 0x206378;
export const SEA_WAVE_MID = 0x368b9d;
export const SEA_WAVE_HIGH = 0x68bdbb;

/** Hulls, as seen from above. */
export const HULL = 0x73989b;
export const HULL_DECK = 0xc0d1c3;
export const HULL_WRECK = 0x2a3140;

/** What a shot found. */
export const MISS = 0xc3d2df;
export const HIT = 0xef6d3a;
export const SUNK = 0xd0342c;

/** The cell under the pointer, legal and illegal. */
export const AIM = 0xc5f66a;
export const LEGAL = 0xb2e887;
export const ILLEGAL = 0xd0342c;
