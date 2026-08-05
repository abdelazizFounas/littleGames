import { FLEET_CELLS, GRID_SIZE } from './constants.ts';
import { cellsOf, checkFleet, occupiedCells } from './placement.ts';
import {
  opponentOf,
  shipLength,
  type BattleshipState,
  type Board,
  type Placement,
  type Shot,
  type ShotResult,
  type Side,
} from './state.ts';

/** Why an action was refused, in words meant to be shown. */
export type ActionProblem =
  | 'not your turn'
  | 'the game is not being played'
  | 'that cell has already been fired at'
  | 'that cell is off the board';

function isSunk(placement: Placement, length: number, incoming: readonly Shot[]): boolean {
  const struck = new Set(incoming.map((shot) => shot.row * GRID_SIZE + shot.column));
  return cellsOf(placement, length).every((cell) =>
    struck.has(cell.row * GRID_SIZE + cell.column),
  );
}

/** How many of a board's ships are on the bottom. */
export function sunkCount(board: Board): number {
  return board.fleet.filter((placement, index) =>
    isSunk(placement, shipLength(index), board.incoming),
  ).length;
}

/** Confirms one player's fleet, and opens play once both have. */
export function placeFleet(
  state: BattleshipState,
  side: Side,
  fleet: readonly Placement[],
): { state: BattleshipState; problem: string | null } {
  if (state.phase !== 'placement') {
    return { state, problem: 'ships can only be placed before the game starts' };
  }
  if (state.boards[side].ready) {
    return { state, problem: 'your fleet is already placed' };
  }

  const problem = checkFleet(fleet);
  if (problem !== null) {
    return { state, problem };
  }

  const boards = { ...state.boards, [side]: { ...state.boards[side], fleet, ready: true } };
  const bothReady = boards.a.ready && boards.b.ready;

  return {
    state: { ...state, boards, phase: bothReady ? 'playing' : 'placement' },
    problem: null,
  };
}

/**
 * Fires at a cell and reports what was found.
 *
 * A miss passes the turn; a hit keeps it. That is the rule most people play by,
 * and it is what makes a good guess worth something beyond the cell itself.
 */
export function fire(
  state: BattleshipState,
  side: Side,
  shot: Shot,
): { state: BattleshipState; result: ShotResult | null; problem: ActionProblem | null } {
  if (state.phase !== 'playing') {
    return { state, result: null, problem: 'the game is not being played' };
  }
  if (state.turn !== side) {
    return { state, result: null, problem: 'not your turn' };
  }
  if (shot.row < 0 || shot.row >= GRID_SIZE || shot.column < 0 || shot.column >= GRID_SIZE) {
    return { state, result: null, problem: 'that cell is off the board' };
  }

  const target = opponentOf(side);
  const board = state.boards[target];

  if (board.incoming.some((past) => past.row === shot.row && past.column === shot.column)) {
    // Refused rather than wasted: firing twice at the same square is a misclick,
    // and taking the turn for it would punish the wrong thing.
    return { state, result: null, problem: 'that cell has already been fired at' };
  }

  const incoming = [...board.incoming, shot];
  const struck = occupiedCells(board.fleet).has(shot.row * GRID_SIZE + shot.column);

  let result: ShotResult = 'miss';
  if (struck) {
    const hitShip = board.fleet.findIndex((placement, index) =>
      cellsOf(placement, shipLength(index)).some(
        (cell) => cell.row === shot.row && cell.column === shot.column,
      ),
    );
    const placement = board.fleet[hitShip];
    result =
      placement !== undefined && isSunk(placement, shipLength(hitShip), incoming) ? 'sunk' : 'hit';
  }

  const hitsTaken = incoming.filter((past) =>
    occupiedCells(board.fleet).has(past.row * GRID_SIZE + past.column),
  ).length;
  const defeated = hitsTaken >= FLEET_CELLS;

  return {
    state: {
      ...state,
      boards: { ...state.boards, [target]: { ...board, incoming } },
      // A hit keeps the turn; a miss hands it over.
      turn: struck ? side : target,
      phase: defeated ? 'finished' : 'playing',
      winner: defeated ? side : null,
    },
    result,
    problem: null,
  };
}
