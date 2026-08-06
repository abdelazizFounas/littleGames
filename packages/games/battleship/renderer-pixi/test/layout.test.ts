import { GRID_SIZE, SHIP_LENGTHS } from '@littlegames/battleship-logic';
import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL,
  GRID,
  LAYOUTS,
  berthAtField,
  cellAtField,
  cellCentre,
  cellCorner,
  layoutFor,
  type Layout,
} from '../src/layout.ts';

/**
 * The arithmetic that replaces hit-testing.
 *
 * A canvas has no elements to click, so a pointer becomes a cell — or a ship in
 * the tray — by dividing down, and nothing on screen will tell you when that
 * division is off by a gutter. This is the one part of the renderer that can be
 * checked without a GPU, and it is also the part worth checking.
 */

const ALL: readonly [string, Layout][] = [
  ['playing, stacked', LAYOUTS.PLAY_TALL],
  ['playing, side by side', LAYOUTS.PLAY_WIDE],
  ['placing, tray below', LAYOUTS.PLACE_TALL],
  ['placing, tray beside', LAYOUTS.PLACE_WIDE],
];

describe.each(ALL)('%s', (_name, layout) => {
  it('reads back every cell of every grid it draws', () => {
    const grids = layout.enemy === null ? (['own'] as const) : (['enemy', 'own'] as const);
    for (const grid of grids) {
      for (let row = 0; row < GRID_SIZE; row += 1) {
        for (let column = 0; column < GRID_SIZE; column += 1) {
          const centre = cellCentre(layout, grid, row, column);

          expect(cellAtField(layout, centre.x, centre.y)).toEqual({ grid, row, column });
        }
      }
    }
  });

  it('reads the corners of a cell as that same cell', () => {
    const centre = cellCentre(layout, 'own', 4, 7);
    const nudge = CELL / 2 - 0.5;

    for (const [dx, dy] of [
      [-nudge, -nudge],
      [nudge, -nudge],
      [-nudge, nudge],
      [nudge, nudge],
    ] as const) {
      expect(cellAtField(layout, centre.x + dx, centre.y + dy)).toEqual({
        grid: 'own',
        row: 4,
        column: 7,
      });
    }
  });

  it('puts the corner of a cell exactly half a cell from its centre', () => {
    const corner = cellCorner(layout, 'own', 3, 6);
    const centre = cellCentre(layout, 'own', 3, 6);

    expect(centre.x - corner.x).toBe(CELL / 2);
    expect(centre.y - corner.y).toBe(CELL / 2);
  });

  it('finds nothing outside the grids and the tray', () => {
    expect(cellAtField(layout, 0, 0)).toBeNull();
    expect(berthAtField(layout, 0, 0)).toBeNull();
    // The strip carrying whose turn it is belongs to neither board.
    expect(cellAtField(layout, layout.width / 2, layout.statusY)).toBeNull();
  });

  it('fits everything it positions inside the field it asks for', () => {
    for (const origin of [layout.enemy, layout.own]) {
      if (origin === null) {
        continue;
      }
      expect(origin.x).toBeGreaterThanOrEqual(0);
      expect(origin.y).toBeGreaterThanOrEqual(0);
      expect(origin.x + BOARD_WIDTH).toBeLessThanOrEqual(layout.width);
      expect(origin.y + BOARD_HEIGHT).toBeLessThanOrEqual(layout.height);
    }
    for (const berth of layout.tray ?? []) {
      expect(berth.x).toBeGreaterThanOrEqual(0);
      expect(berth.x + berth.width).toBeLessThanOrEqual(layout.width);
      expect(berth.y + CELL).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe.each(ALL.slice(0, 2))('%s', (_name, layout) => {
  it('shows both grids and no tray', () => {
    expect(layout.enemy).not.toBeNull();
    expect(layout.tray).toBeNull();
  });
});

describe.each(ALL.slice(2))('%s', (_name, layout) => {
  it('shows the tray and hides the empty opposing grid', () => {
    expect(layout.enemy).toBeNull();
    expect(layout.tray).toHaveLength(SHIP_LENGTHS.length);
  });

  it('gives every ship a berth as wide as the ship', () => {
    for (const [index, berth] of (layout.tray ?? []).entries()) {
      expect(berth.width).toBe((SHIP_LENGTHS[index] ?? 0) * CELL);
    }
  });

  it('reads back every ship in the tray, and where along it was taken hold of', () => {
    for (const [ship, berth] of (layout.tray ?? []).entries()) {
      const length = SHIP_LENGTHS[ship] ?? 0;
      for (let along = 0; along < length; along += 1) {
        const x = berth.x + along * CELL + CELL / 2;

        expect(berthAtField(layout, x, berth.y + CELL / 2)).toEqual({ ship, along });
      }
    }
  });

  it('does not let two berths overlap', () => {
    const berths = layout.tray ?? [];
    for (const [index, berth] of berths.entries()) {
      for (const [other, against] of berths.entries()) {
        if (index >= other) {
          continue;
        }
        const apart =
          berth.x + berth.width <= against.x ||
          against.x + against.width <= berth.x ||
          berth.y + CELL <= against.y ||
          against.y + CELL <= berth.y;

        expect(apart).toBe(true);
      }
    }
  });

  it('leaves the name under a ship alone, so a label cannot pick it up', () => {
    const berth = (layout.tray ?? [])[0];

    expect(berth).toBeDefined();
    expect(berthAtField(layout, (berth?.x ?? 0) + 4, (berth?.y ?? 0) + CELL + 8)).toBeNull();
  });
});

describe('choosing an arrangement', () => {
  it('stacks the grids in a box taller than it is wide', () => {
    expect(layoutFor(480, 1000, false)).toBe(LAYOUTS.PLAY_TALL);
  });

  it('puts them side by side in a box wider than it is tall', () => {
    expect(layoutFor(1280, 720, false)).toBe(LAYOUTS.PLAY_WIDE);
  });

  it('swaps the empty grid for the tray while a fleet is being laid out', () => {
    expect(layoutFor(480, 1000, true)).toBe(LAYOUTS.PLACE_TALL);
    expect(layoutFor(1280, 720, true)).toBe(LAYOUTS.PLACE_WIDE);
  });

  it('asks for a field the stylesheet can match', () => {
    // The two playing aspect ratios are written into the stylesheet so that a
    // well-sized screen letterboxes nothing. If these change, that changes.
    expect(LAYOUTS.PLAY_WIDE.width / LAYOUTS.PLAY_WIDE.height).toBeCloseTo(948 / 542, 5);
    expect(LAYOUTS.PLAY_TALL.width / LAYOUTS.PLAY_TALL.height).toBeCloseTo(474 / 996, 5);
  });

  it('gives the board being arranged at least as much room as playing does', () => {
    // The whole reason the opposing grid is hidden during placement. If the
    // placement field were the wider of the two, hiding it would have bought
    // nothing.
    expect(LAYOUTS.PLACE_WIDE.width).toBeLessThan(LAYOUTS.PLAY_WIDE.width);
    expect(LAYOUTS.PLACE_TALL.height).toBeLessThan(LAYOUTS.PLAY_TALL.height);
  });
});

describe('the grid itself', () => {
  it('is ten cells square', () => {
    expect(GRID).toBe(GRID_SIZE * CELL);
  });
});
