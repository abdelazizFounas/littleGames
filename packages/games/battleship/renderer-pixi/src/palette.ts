/**
 * Every colour the game is drawn in.
 *
 * Nothing here comes from an image file. Water, hulls, torpedoes and explosions
 * are all `Graphics` and motion, which keeps the repository free of binaries and
 * keeps the look of a piece with the sharp-edged interface around it. If sprite
 * art ever replaces them, this package is the only one that changes.
 */
export const BACKGROUND = 0x101319;
export const FOREGROUND = 0xeef0f4;
export const MUTED = 0x8b93a3;
export const LINE = 0x39404f;

/** The sea, from its floor upwards. */
export const SEA_DEEP = 0x0b1c2c;
export const SEA_WAVE_LOW = 0x1b4d6b;
export const SEA_WAVE_MID = 0x2f6d94;
export const SEA_WAVE_HIGH = 0x4f9dc4;

/** Hulls, as seen from above. */
export const HULL = 0x7c8798;
export const HULL_DECK = 0xa8b2c1;
export const HULL_WRECK = 0x2a3140;

/** What a shot found. */
export const MISS = 0xc3d2df;
export const HIT = 0xef6d3a;
export const SUNK = 0xd0342c;

/** The cell under the pointer, legal and illegal. */
export const AIM = 0xf2c14e;
export const LEGAL = 0x4fbf87;
export const ILLEGAL = 0xd0342c;
