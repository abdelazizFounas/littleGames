import { GRID_SIZE, SHIP_LENGTHS } from './constants.ts';
import { FLEET_SIZE, shipLength, type Placement } from './state.ts';

/** Every cell one ship occupies. */
export function cellsOf(placement: Placement, length: number): { row: number; column: number }[] {
  const cells: { row: number; column: number }[] = [];
  for (let step = 0; step < length; step += 1) {
    cells.push({
      row: placement.orientation === 'vertical' ? placement.row + step : placement.row,
      column: placement.orientation === 'horizontal' ? placement.column + step : placement.column,
    });
  }
  return cells;
}

/** Why a fleet was refused, in words meant to be shown. */
export type PlacementProblem =
  | 'wrong number of ships'
  | 'a ship runs off the board'
  | 'two ships overlap';

/**
 * Checks a whole fleet at once.
 *
 * A fleet rather than a ship at a time, because overlap is a property of the
 * arrangement and not of any one ship in it. The client runs this to refuse an
 * illegal drag on the spot; the server runs it again before believing anything,
 * because a check the client ran is a check the client can skip.
 */
export function checkFleet(fleet: readonly Placement[]): PlacementProblem | null {
  if (fleet.length !== FLEET_SIZE) {
    return 'wrong number of ships';
  }

  const taken = new Set<number>();

  for (const [index, placement] of fleet.entries()) {
    const length = shipLength(index);
    for (const cell of cellsOf(placement, length)) {
      if (cell.row < 0 || cell.row >= GRID_SIZE || cell.column < 0 || cell.column >= GRID_SIZE) {
        return 'a ship runs off the board';
      }
      const key = cell.row * GRID_SIZE + cell.column;
      if (taken.has(key)) {
        return 'two ships overlap';
      }
      taken.add(key);
    }
  }

  return null;
}

/** Every cell a fleet occupies, as a set of `row * GRID_SIZE + column` keys. */
export function occupiedCells(fleet: readonly Placement[]): Set<number> {
  const taken = new Set<number>();
  for (const [index, placement] of fleet.entries()) {
    for (const cell of cellsOf(placement, shipLength(index))) {
      taken.add(cell.row * GRID_SIZE + cell.column);
    }
  }
  return taken;
}

export { SHIP_LENGTHS };
