/**
 * The board is square and addressed the way players read it aloud: a letter for
 * the row, a number for the column. Everything below is a zero-based index; the
 * labels exist only where a human sees them.
 */
export const GRID_SIZE = 10;

export const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

/**
 * The fleet, longest first.
 *
 * Ordered that way because the long ships are the hard ones to fit: placing
 * them while the board is empty is what stops a random arrangement painting
 * itself into a corner.
 */
export const SHIP_LENGTHS = [5, 4, 3, 3, 2] as const;

/**
 * What each ship is called, in the same order.
 *
 * Presentation only — the rules never look at a name, and neither does the
 * server. They exist so that a screen can say "place your carrier" instead of
 * "place your ship of five", and so the ships waiting to be placed can be told
 * apart by more than their length.
 */
export const SHIP_NAMES = ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'] as const;

export const FLEET_SIZE = SHIP_LENGTHS.length;

/** How many hits sink an entire fleet, and so win the game. */
export const FLEET_CELLS = SHIP_LENGTHS.reduce((total, length) => total + length, 0);

/** Human label for a cell, as it would be called out: "B7". */
export function cellLabel(row: number, column: number): string {
  return `${ROW_LABELS[row] ?? '?'}${String(column + 1)}`;
}
