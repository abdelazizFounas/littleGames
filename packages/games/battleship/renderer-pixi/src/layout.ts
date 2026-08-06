import { GRID_SIZE, SHIP_LENGTHS } from '@littlegames/battleship-logic';

/**
 * Where everything sits, in fixed logical units.
 *
 * A canvas has no elements to click, so a pointer becomes a cell — or a ship in
 * the tray — by arithmetic rather than by hit-testing. That arithmetic is only
 * correct if drawing and reading agree about the geometry down to the unit,
 * which is why both come from this file and nowhere else.
 */

/** Side of one cell. */
export const CELL = 40;

/** Side of a whole grid. */
export const GRID = GRID_SIZE * CELL;

/** Room to the left of a grid for the row letters. */
const GUTTER = 26;

/** Room above a grid for the column numbers. */
const HEADER = 24;

/** Room above those for the caption naming the grid. */
const TITLE = 30;

/** Size of one board block: a grid with its labels and caption. */
export const BOARD_WIDTH = GUTTER + GRID;
export const BOARD_HEIGHT = TITLE + HEADER + GRID;

/** Where the grid starts inside its board block. */
export const GRID_LEFT = GUTTER;
export const GRID_TOP = TITLE + HEADER;

/** Baselines inside a board block. */
export const TITLE_Y = 16;
export const HEADER_Y = TITLE + HEADER / 2;

/** Margin around everything. */
const PAD = 24;

/** Height of the strip carrying whose turn it is. */
const STATUS = 40;

/** Space between the two boards when they sit side by side. */
const COLUMN_GAP = 48;

/** How much room a ship waiting in the tray takes: its hull and its name. */
const BERTH_HEIGHT = CELL + 20;

/** Space between two ships in the tray. */
const BERTH_GAP = 16;

/** Which grid a point fell on. */
export type Grid = 'enemy' | 'own';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where one ship waits to be placed. Its hull fills the top `CELL` of it. */
export interface Berth {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** One arrangement of the boards, and the field size it needs. */
export interface Layout {
  /** Identifies the arrangement, so a change of one can be noticed. */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /**
   * Top-left of the opponent's board, or nothing while it is not shown.
   *
   * During placement it is not: an empty grid nobody can touch is not worth the
   * room, and giving that room to the board being arranged is what makes the
   * job doable on a telephone.
   */
  readonly enemy: Point | null;
  readonly own: Point;
  /** Where each ship of the fleet waits, in fleet order, or nothing. */
  readonly tray: readonly Berth[] | null;
  /** Centre line of the strip carrying whose turn it is. */
  readonly statusY: number;
}

/** How wide the line carrying whose turn it is may be before it must shrink. */
export function statusWidthOf(layout: Layout): number {
  return layout.width - PAD * 2;
}

/** Widths of the five ships as they lie in the tray, all lying flat. */
const BERTH_WIDTHS = SHIP_LENGTHS.map((length) => length * CELL);

function widthOf(indices: readonly number[]): number {
  const ships = indices.reduce((total, index) => total + (BERTH_WIDTHS[index] ?? 0), 0);
  return ships + Math.max(indices.length - 1, 0) * BERTH_GAP;
}

/** Lays a row of ships out centred on a given line. */
function berthRow(indices: readonly number[], centreX: number, y: number): Berth[] {
  let x = centreX - widthOf(indices) / 2;
  return indices.map((index) => {
    const width = BERTH_WIDTHS[index] ?? 0;
    const berth = { x, y, width };
    x += width + BERTH_GAP;
    return berth;
  });
}

/** The two grids stacked, as the game is drawn on paper. */
const PLAY_TALL: Layout = {
  key: 'play-tall',
  width: BOARD_WIDTH + PAD * 2,
  height: PAD * 2 + BOARD_HEIGHT * 2 + STATUS,
  enemy: { x: PAD, y: PAD },
  own: { x: PAD, y: PAD + BOARD_HEIGHT + STATUS },
  tray: null,
  statusY: PAD + BOARD_HEIGHT + STATUS / 2,
};

/**
 * The two grids side by side.
 *
 * Stacking them on a landscape screen letterboxes the pair down to a narrow
 * column with most of the display left empty, so a wide box gets the wide
 * arrangement instead.
 */
const PLAY_WIDE: Layout = {
  key: 'play-wide',
  width: PAD * 2 + BOARD_WIDTH * 2 + COLUMN_GAP,
  height: PAD * 2 + BOARD_HEIGHT + STATUS,
  enemy: { x: PAD, y: PAD },
  own: { x: PAD + BOARD_WIDTH + COLUMN_GAP, y: PAD },
  tray: null,
  statusY: PAD + BOARD_HEIGHT + STATUS / 2,
};

/** Placing a fleet on a wide screen: the board, and the tray beside it. */
const PLACE_WIDE: Layout = (() => {
  const trayWidth = Math.max(...BERTH_WIDTHS);
  const trayHeight = BERTH_HEIGHT * SHIP_LENGTHS.length + BERTH_GAP * (SHIP_LENGTHS.length - 1);
  const trayX = PAD + BOARD_WIDTH + COLUMN_GAP;
  const trayTop = PAD + (BOARD_HEIGHT - trayHeight) / 2;

  return {
    key: 'place-wide',
    width: PAD * 2 + BOARD_WIDTH + COLUMN_GAP + trayWidth,
    height: PAD * 2 + BOARD_HEIGHT + STATUS,
    enemy: null,
    own: { x: PAD, y: PAD },
    // Longest at the top, so the tray reads as the fleet list it is.
    tray: SHIP_LENGTHS.map((_, index) => ({
      x: trayX,
      y: trayTop + index * (BERTH_HEIGHT + BERTH_GAP),
      width: BERTH_WIDTHS[index] ?? 0,
    })),
    statusY: PAD + BOARD_HEIGHT + STATUS / 2,
  };
})();

/** Placing a fleet on a telephone: the board, and the tray under it. */
const PLACE_TALL: Layout = (() => {
  const width = BOARD_WIDTH + PAD * 2;
  const centreX = width / 2;
  const firstRow = PAD + BOARD_HEIGHT + 20;
  const secondRow = firstRow + BERTH_HEIGHT + BERTH_GAP;

  return {
    key: 'place-tall',
    width,
    height: secondRow + BERTH_HEIGHT + STATUS + PAD,
    enemy: null,
    own: { x: PAD, y: PAD },
    // Two rows rather than one: five ships end to end are wider than the board
    // they are going onto.
    tray: [...berthRow([0, 1], centreX, firstRow), ...berthRow([2, 3, 4], centreX, secondRow)],
    statusY: secondRow + BERTH_HEIGHT + STATUS / 2,
  };
})();

/**
 * Picks the arrangement that fills the box it is given.
 *
 * Placing a fleet and playing the game want different pictures, so the field
 * changes shape between them. The box on the page does not: the renderer
 * letterboxes inside it either way, so nothing on the page reflows and only the
 * scale changes.
 */
export function layoutFor(width: number, height: number, placing: boolean): Layout {
  if (width >= height) {
    return placing ? PLACE_WIDE : PLAY_WIDE;
  }
  return placing ? PLACE_TALL : PLAY_TALL;
}

export const LAYOUTS = { PLAY_TALL, PLAY_WIDE, PLACE_TALL, PLACE_WIDE } as const;

export function originOf(layout: Layout, grid: Grid): Point | null {
  return grid === 'enemy' ? layout.enemy : layout.own;
}

/** Centre of a cell, in field units. */
export function cellCentre(layout: Layout, grid: Grid, row: number, column: number): Point {
  const origin = originOf(layout, grid) ?? layout.own;
  return {
    x: origin.x + GRID_LEFT + column * CELL + CELL / 2,
    y: origin.y + GRID_TOP + row * CELL + CELL / 2,
  };
}

/** Top-left corner of a cell, in field units. */
export function cellCorner(layout: Layout, grid: Grid, row: number, column: number): Point {
  const origin = originOf(layout, grid) ?? layout.own;
  return {
    x: origin.x + GRID_LEFT + column * CELL,
    y: origin.y + GRID_TOP + row * CELL,
  };
}

/** Centre of a whole grid, which is where a shot at it is fired from. */
export function gridCentre(layout: Layout, grid: Grid): Point {
  const origin = originOf(layout, grid) ?? layout.own;
  return { x: origin.x + GRID_LEFT + GRID / 2, y: origin.y + GRID_TOP + GRID / 2 };
}

export interface HitCell {
  readonly grid: Grid;
  readonly row: number;
  readonly column: number;
}

/**
 * Which cell a point in field units falls on, if any.
 *
 * The inverse of `cellCorner`, and half of this renderer's input handling:
 * divide the offset from a grid's corner by the cell size and take the floor.
 */
export function cellAtField(layout: Layout, x: number, y: number): HitCell | null {
  for (const grid of ['enemy', 'own'] as const) {
    const origin = originOf(layout, grid);
    if (origin === null) {
      continue;
    }
    const localX = x - origin.x - GRID_LEFT;
    const localY = y - origin.y - GRID_TOP;
    if (localX < 0 || localX >= GRID || localY < 0 || localY >= GRID) {
      continue;
    }
    return { grid, row: Math.floor(localY / CELL), column: Math.floor(localX / CELL) };
  }
  return null;
}

/** Which ship of the tray a point in field units falls on, and where along it. */
export function berthAtField(
  layout: Layout,
  x: number,
  y: number,
): { readonly ship: number; readonly along: number } | null {
  if (layout.tray === null) {
    return null;
  }
  for (const [ship, berth] of layout.tray.entries()) {
    // Only the hull is a handle. The name under it is a label, and a label that
    // picks things up when touched is a trap.
    if (x >= berth.x && x < berth.x + berth.width && y >= berth.y && y < berth.y + CELL) {
      return { ship, along: Math.floor((x - berth.x) / CELL) };
    }
  }
  return null;
}
