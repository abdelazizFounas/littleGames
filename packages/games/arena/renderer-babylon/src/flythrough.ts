import { normalizeAim } from '@littlegames/arena-logic';
import type { ArenaCamera } from './view.ts';

/**
 * A camera that flies through the arena on its own, with nobody playing.
 *
 * It exists so the arena can be looked at before there is anything to look at
 * *with* — no server, no prediction, no opponent. It is also the cheapest way
 * to judge the geometry and the palette, which are otherwise only visible in
 * the middle of a match.
 *
 * Pure, and therefore testable: a debug camera that flew through a crate would
 * look like a bug in the renderer, so the test asserts it never does.
 */

/** How long one loop takes, in seconds. Slow: this is a look, not a ride. */
export const FLYTHROUGH_PERIOD_SECONDS = 24;

const FIELD_OF_VIEW = 0.9;

/** What the camera looks at: the middle of the ravine, at about head height. */
const CENTRE = { x: 0, y: 1, z: 0 };

/**
 * Where the eye is at a given moment.
 *
 * The path is one orbit whose radius and height close in on the arena as it
 * swings across the middle, and open back out as it comes round the ends. The
 * tightest part of it is over the ravine, which is the one place in the arena
 * guaranteed to be empty — the whole layout rests on nothing standing in the
 * gap, so a camera that dives through it cannot clip anything either.
 */
export function flythroughAt(seconds: number): ArenaCamera {
  const angle = (2 * Math.PI * seconds) / FLYTHROUGH_PERIOD_SECONDS;
  const closeness = Math.abs(Math.sin(angle));

  // High enough at the far ends to pass well over the six-metre back walls
  // rather than grazing their tops, and low enough across the middle to see the
  // arena from about where a player stands in it.
  const radius = 22 - 16 * closeness;
  const height = 11 - 8 * closeness;
  const position = {
    x: radius * Math.sin(angle),
    y: height,
    z: radius * Math.cos(angle),
  };

  return {
    position,
    forward: normalizeAim({
      x: CENTRE.x - position.x,
      y: CENTRE.y - position.y,
      z: CENTRE.z - position.z,
    }),
    fieldOfView: FIELD_OF_VIEW,
  };
}
