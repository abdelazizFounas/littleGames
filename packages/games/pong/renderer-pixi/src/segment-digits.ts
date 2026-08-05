import type { Graphics } from 'pixi.js';

/**
 * Digits drawn as seven straight bars, the way a scoreboard does it.
 *
 * A font would round every corner of every glyph, and no font can be relied on
 * to be installed anyway. Seven rectangles per digit are sharp by construction,
 * need no asset, and look like the machine this game came from.
 */

/** Which of the seven bars each digit lights, in the order below. */
const SEGMENTS: Record<string, readonly number[]> = {
  '0': [0, 1, 2, 3, 4, 5],
  '1': [1, 2],
  '2': [0, 1, 6, 4, 3],
  '3': [0, 1, 6, 2, 3],
  '4': [5, 6, 1, 2],
  '5': [0, 5, 6, 2, 3],
  '6': [0, 5, 6, 4, 2, 3],
  '7': [0, 1, 2],
  '8': [0, 1, 2, 3, 4, 5, 6],
  '9': [0, 1, 2, 3, 5, 6],
};

/** Width of a digit as a fraction of its height. */
const ASPECT = 0.58;
/** Bar thickness as a fraction of the digit's height. */
const THICKNESS = 0.16;
/** Gap between digits, as a fraction of a digit's width. */
const TRACKING = 0.28;

function drawDigit(target: Graphics, digit: string, x: number, y: number, height: number): void {
  const lit = SEGMENTS[digit];
  if (lit === undefined) {
    return;
  }

  const width = height * ASPECT;
  const thickness = height * THICKNESS;
  const middle = y + height / 2;
  // Vertical bars stop short of the horizontal ones they meet.
  const armHeight = height / 2 - thickness * 1.5;

  // Ordered: top, top-right, bottom-right, bottom, bottom-left, top-left, middle.
  const bars: readonly (readonly [number, number, number, number])[] = [
    [x + thickness, y, width - thickness * 2, thickness],
    [x + width - thickness, y + thickness, thickness, armHeight],
    [x + width - thickness, middle + thickness / 2, thickness, armHeight],
    [x + thickness, y + height - thickness, width - thickness * 2, thickness],
    [x, middle + thickness / 2, thickness, armHeight],
    [x, y + thickness, thickness, armHeight],
    [x + thickness, middle - thickness / 2, width - thickness * 2, thickness],
  ];

  for (const index of lit) {
    const bar = bars[index];
    if (bar !== undefined) {
      target.rect(bar[0], bar[1], bar[2], bar[3]);
    }
  }
}

/** Total width a number will occupy at the given height. */
export function measureNumber(value: number, height: number): number {
  const digits = String(value).length;
  const width = height * ASPECT;
  return digits * width + (digits - 1) * width * TRACKING;
}

/**
 * Draws a number centred horizontally on `centreX`, with its top at `topY`.
 *
 * The caller is responsible for clearing and filling: batching every digit into
 * one fill keeps a score change to a single draw call.
 */
export function drawNumber(
  target: Graphics,
  value: number,
  centreX: number,
  topY: number,
  height: number,
): void {
  const text = String(value);
  const width = height * ASPECT;
  const advance = width * (1 + TRACKING);
  let x = centreX - measureNumber(value, height) / 2;

  for (const digit of text) {
    drawDigit(target, digit, x, topY, height);
    x += advance;
  }
}
