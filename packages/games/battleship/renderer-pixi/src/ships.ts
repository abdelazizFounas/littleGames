import type { Orientation, Placement } from '@littlegames/battleship-logic';
import { Container, Graphics } from 'pixi.js';
import { CELL, GRID_LEFT, GRID_TOP } from './layout.ts';
import { HULL, HULL_DECK, HULL_WRECK, LINE } from './palette.ts';

/**
 * How a ship is drawn, wherever it happens to be.
 *
 * The same hull appears in three places — waiting in the tray, hanging off the
 * pointer, and sitting on the board — so the shape is written once and given a
 * corner to start from. Only its colour changes with the situation.
 */

/** How long a ship takes to go under, once its last cell is struck. */
const SINK_SECONDS = 1.6;

/** How far it lists over as it goes. */
const SINK_TILT = 0.26;

/** How much smaller the hull is than the cells it occupies. */
const INSET_ALONG = 6;
const INSET_ACROSS = 8;

/** The box a ship of this length fills, lying this way. */
export function hullSize(length: number, orientation: Orientation): { width: number; height: number } {
  return orientation === 'horizontal'
    ? { width: length * CELL, height: CELL }
    : { width: CELL, height: length * CELL };
}

/** How a hull is painted: its body, its outline and how solid it is. */
export interface HullPaint {
  readonly body: number;
  readonly outline: number;
  readonly alpha: number;
}

export const AFLOAT: HullPaint = { body: HULL, outline: LINE, alpha: 1 };

/**
 * Draws one hull with its bow at the far end, from a top-left corner.
 *
 * Drawn the right way round rather than drawn flat and turned, because a ship
 * that is turned is also a ship whose deck detail is turned, and reading a
 * rotated transform back out to hit-test it is exactly the sort of arithmetic
 * this renderer keeps in one file.
 */
export function drawHull(
  target: Graphics,
  x: number,
  y: number,
  length: number,
  orientation: Orientation,
  paint: HullPaint,
): void {
  const along = length * CELL - INSET_ALONG * 2;
  const across = CELL - INSET_ACROSS * 2;
  const bow = across * 0.75;
  const notch = across * 0.3;

  // Everything below is worked out along the ship and across it, and only then
  // turned into x and y. One shape, described once.
  const point = (down: number, side: number): [number, number] =>
    orientation === 'horizontal'
      ? [x + INSET_ALONG + down, y + INSET_ACROSS + side]
      : [x + INSET_ACROSS + side, y + INSET_ALONG + down];

  target
    .poly([
      ...point(0, 0),
      ...point(along - bow, 0),
      ...point(along, across / 2),
      ...point(along - bow, across),
      ...point(0, across),
      ...point(notch, across / 2),
    ])
    .fill({ color: paint.body, alpha: paint.alpha })
    .stroke({ width: 2, color: paint.outline, alpha: paint.alpha });

  // A deck, and one bulkhead per cell, so the length of a ship can be counted
  // off the drawing rather than measured against the grid under it.
  const deckStart = point(across * 0.55, across / 4);
  const deckEnd = point(along - across * 0.55, (across * 3) / 4);
  target.roundRect(
    Math.min(deckStart[0], deckEnd[0]),
    Math.min(deckStart[1], deckEnd[1]),
    Math.abs(deckEnd[0] - deckStart[0]),
    Math.abs(deckEnd[1] - deckStart[1]),
    across / 5,
  );
  target.fill({ color: HULL_DECK, alpha: 0.65 * paint.alpha });

  for (let division = 1; division < length; division += 1) {
    const at = (division * along) / length;
    target.moveTo(...point(at, 2)).lineTo(...point(at, across - 2));
  }
  target.stroke({ width: 1.5, color: paint.outline, alpha: 0.6 * paint.alpha });
}

export interface Hull {
  readonly view: Container;
  /** Seconds since it started going down, or none while it is afloat. */
  sinking: number | null;
}

/**
 * Builds one ship of the confirmed fleet, sitting where the fleet says it sits.
 *
 * Each is its own display object rather than a shape in a shared drawing,
 * because a ship that goes down has to move on its own: it lists, settles and
 * darkens while the four beside it sit still. Sharing one `Graphics` would mean
 * rebuilding all five every frame to animate one.
 */
export function createHull(placement: Placement, length: number): Hull {
  const view = new Container();
  const body = new Graphics();
  const { width, height } = hullSize(length, placement.orientation);

  drawHull(body, 0, 0, length, placement.orientation, AFLOAT);
  // Offset inside a container placed at the ship's centre, so that listing over
  // as it sinks turns it about its middle and not about its stern.
  body.position.set(-width / 2, -height / 2);
  view.addChild(body);
  view.position.set(
    GRID_LEFT + placement.column * CELL + width / 2,
    GRID_TOP + placement.row * CELL + height / 2,
  );

  return { view, sinking: null };
}

/** Moves a sinking ship on by one frame. Afloat ships are left alone. */
export function advanceHull(hull: Hull, deltaSeconds: number): void {
  if (hull.sinking === null) {
    return;
  }
  hull.sinking = Math.min(hull.sinking + deltaSeconds, SINK_SECONDS);
  const progress = hull.sinking / SINK_SECONDS;

  hull.view.rotation = SINK_TILT * progress;
  hull.view.scale.set(1 - progress * 0.12);
  hull.view.alpha = 1 - progress * 0.55;
  for (const child of hull.view.children) {
    if (child instanceof Graphics) {
      // Going down into darker water, rather than simply fading out, which
      // would read as the ship being deleted.
      child.tint = progress > 0.5 ? HULL_WRECK : HULL;
    }
  }
}
