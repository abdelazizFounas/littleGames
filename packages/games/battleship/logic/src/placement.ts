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

/**
 * A ship that carries its own length.
 *
 * A complete fleet does not need this: its ships are in fleet order, so the
 * index gives the length. One being arranged does, because ships can be laid
 * down and picked back up in any order, and then a position in a list means
 * nothing.
 */
export interface SeatedShip {
  readonly placement: Placement;
  readonly length: number;
}

/** Every cell a set of ships occupies, as `row * GRID_SIZE + column` keys. */
export function cellsTakenBy(ships: readonly SeatedShip[]): Set<number> {
  const taken = new Set<number>();
  for (const ship of ships) {
    for (const cell of cellsOf(ship.placement, ship.length)) {
      taken.add(cell.row * GRID_SIZE + cell.column);
    }
  }
  return taken;
}

/** Every cell a complete fleet occupies, taking each length from its order. */
export function occupiedCells(fleet: readonly Placement[]): Set<number> {
  return cellsTakenBy(
    fleet.map((placement, index) => ({ placement, length: shipLength(index) })),
  );
}

/**
 * Whether one more ship can go here, alongside the ships already down.
 *
 * `checkFleet` answers for a complete fleet and nothing less, which is the
 * right question for the server. A player laying ships out one at a time asks a
 * different one, on a fleet that is still half empty — and asks it on every
 * pointer move, which is what makes an illegal spot refuse itself under the
 * cursor rather than after a round trip.
 */
export function fits(
  alongside: readonly SeatedShip[],
  placement: Placement,
  length: number,
): boolean {
  const taken = cellsTakenBy(alongside);
  return cellsOf(placement, length).every(
    (cell) =>
      cell.row >= 0 &&
      cell.row < GRID_SIZE &&
      cell.column >= 0 &&
      cell.column < GRID_SIZE &&
      !taken.has(cell.row * GRID_SIZE + cell.column),
  );
}

/** How many tries one ship gets before the whole arrangement is restarted. */
const PLACEMENT_ATTEMPTS = 200;

/**
 * A legal fleet, laid out at random.
 *
 * Longest first, for the reason `SHIP_LENGTHS` is ordered that way: the long
 * ships are the ones with nowhere left to go once the board is busy. Even so a
 * run can still corner itself, so a ship that cannot be seated after enough
 * tries throws the arrangement away and starts over rather than returning a
 * fleet with a hole in it.
 *
 * The source of randomness is injected so a test can pin it down.
 */
export function randomFleet(random: () => number = Math.random): Placement[] {
  for (;;) {
    const fleet: SeatedShip[] = [];

    for (const length of SHIP_LENGTHS) {
      let seated = false;
      for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS && !seated; attempt += 1) {
        const placement: Placement = {
          row: Math.floor(random() * GRID_SIZE),
          column: Math.floor(random() * GRID_SIZE),
          orientation: random() < 0.5 ? 'horizontal' : 'vertical',
        };
        if (fits(fleet, placement, length)) {
          fleet.push({ placement, length });
          seated = true;
        }
      }
      if (!seated) {
        break;
      }
    }

    if (fleet.length === SHIP_LENGTHS.length) {
      return fleet.map((ship) => ship.placement);
    }
  }
}

export { SHIP_LENGTHS };
