import { describe, expect, it } from 'vitest';
import { FLEET_CELLS, GRID_SIZE, SHIP_LENGTHS, cellLabel } from '../src/constants.ts';
import { cellsOf, checkFleet } from '../src/placement.ts';
import { fire, placeFleet, sunkCount } from '../src/shots.ts';
import { createInitialState, startPlacement, type BattleshipState, type Placement } from '../src/state.ts';

/** A legal fleet: every ship on its own row, hard against the left edge. */
const TIDY_FLEET: Placement[] = SHIP_LENGTHS.map((_, index) => ({
  row: index * 2,
  column: 0,
  orientation: 'horizontal' as const,
}));

function bothPlaced(): BattleshipState {
  let state = startPlacement(createInitialState());
  state = placeFleet(state, 'a', TIDY_FLEET).state;
  state = placeFleet(state, 'b', TIDY_FLEET).state;
  return state;
}

/** Every cell a tidy fleet occupies, in firing order. */
function allFleetCells(): { row: number; column: number }[] {
  return TIDY_FLEET.flatMap((placement, index) => cellsOf(placement, SHIP_LENGTHS[index] ?? 0));
}

describe('the board', () => {
  it('reads cells the way players call them out', () => {
    expect(cellLabel(0, 0)).toBe('A1');
    expect(cellLabel(9, 9)).toBe('J10');
    expect(cellLabel(1, 6)).toBe('B7');
  });

  it('has a fleet of seventeen cells', () => {
    expect(FLEET_CELLS).toBe(17);
    expect(SHIP_LENGTHS).toEqual([5, 4, 3, 3, 2]);
  });
});

describe('placement', () => {
  it('accepts a legal fleet', () => {
    expect(checkFleet(TIDY_FLEET)).toBeNull();
  });

  it('refuses the wrong number of ships', () => {
    expect(checkFleet(TIDY_FLEET.slice(1))).toBe('wrong number of ships');
  });

  it('refuses a ship hanging off the edge', () => {
    const overhanging = [...TIDY_FLEET];
    overhanging[0] = { row: 0, column: GRID_SIZE - 2, orientation: 'horizontal' };

    expect(checkFleet(overhanging)).toBe('a ship runs off the board');
  });

  it('refuses two ships sharing a cell', () => {
    const stacked = TIDY_FLEET.map((placement) => ({ ...placement, row: 0 }));

    expect(checkFleet(stacked)).toBe('two ships overlap');
  });

  it('opens play only once both fleets are placed', () => {
    let state = startPlacement(createInitialState());
    state = placeFleet(state, 'a', TIDY_FLEET).state;
    expect(state.phase).toBe('placement');

    state = placeFleet(state, 'b', TIDY_FLEET).state;
    expect(state.phase).toBe('playing');
  });

  it('refuses a second placement from the same player', () => {
    const state = placeFleet(startPlacement(createInitialState()), 'a', TIDY_FLEET).state;

    expect(placeFleet(state, 'a', TIDY_FLEET).problem).toBe('your fleet is already placed');
  });
});

describe('firing', () => {
  it('reports a miss and hands the turn over', () => {
    // Column 9 is clear of every ship in the tidy fleet.
    const { state, result } = fire(bothPlaced(), 'a', { row: 0, column: 9 });

    expect(result).toBe('miss');
    expect(state.turn).toBe('b');
  });

  it('reports a hit and keeps the turn', () => {
    const { state, result } = fire(bothPlaced(), 'a', { row: 0, column: 0 });

    expect(result).toBe('hit');
    expect(state.turn).toBe('a');
  });

  it('reports a sinking on the last cell of a ship', () => {
    // The two-cell ship sits on row 8.
    let state = bothPlaced();
    expect(fire(state, 'a', { row: 8, column: 0 }).result).toBe('hit');
    state = fire(state, 'a', { row: 8, column: 0 }).state;

    expect(fire(state, 'a', { row: 8, column: 1 }).result).toBe('sunk');
  });

  it('refuses a cell already fired at, without taking the turn', () => {
    let state = bothPlaced();
    state = fire(state, 'a', { row: 0, column: 0 }).state;

    const again = fire(state, 'a', { row: 0, column: 0 });

    expect(again.problem).toBe('that cell has already been fired at');
    expect(again.state.turn).toBe('a');
  });

  it('refuses a shot from the player whose turn it is not', () => {
    expect(fire(bothPlaced(), 'b', { row: 0, column: 0 }).problem).toBe('not your turn');
  });

  it('refuses a cell off the board', () => {
    expect(fire(bothPlaced(), 'a', { row: -1, column: 0 }).problem).toBe('that cell is off the board');
    expect(fire(bothPlaced(), 'a', { row: 0, column: GRID_SIZE }).problem).toBe(
      'that cell is off the board',
    );
  });

  it('refuses a shot before both fleets are placed', () => {
    const state = startPlacement(createInitialState());

    expect(fire(state, 'a', { row: 0, column: 0 }).problem).toBe('the game is not being played');
  });
});

describe('victory', () => {
  it('ends the game when the last cell of the last ship is struck', () => {
    let state = bothPlaced();
    const cells = allFleetCells();

    for (const cell of cells) {
      // Every one of these is a hit, so the turn never leaves A.
      state = fire(state, 'a', cell).state;
    }

    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('a');
    expect(sunkCount(state.boards.b)).toBe(SHIP_LENGTHS.length);
  });

  it('is not won a cell early', () => {
    let state = bothPlaced();
    const cells = allFleetCells();

    for (const cell of cells.slice(0, -1)) {
      state = fire(state, 'a', cell).state;
    }

    expect(state.phase).toBe('playing');
    expect(state.winner).toBeNull();
  });

  it('never mutates the state it was given', () => {
    const state = bothPlaced();
    const before = structuredClone(state);

    fire(state, 'a', { row: 0, column: 0 });

    expect(state).toEqual(before);
  });
});
