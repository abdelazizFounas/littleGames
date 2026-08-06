import { describe, expect, it } from 'vitest';
import { FLEET_CELLS, GRID_SIZE, SHIP_LENGTHS, SHIP_NAMES } from '../src/constants.ts';
import { checkFleet, fits, occupiedCells, randomFleet } from '../src/placement.ts';
import { shipName } from '../src/state.ts';
import {
  alreadyFired,
  canDrop,
  clearDraft,
  createDraft,
  draftFleet,
  dropShip,
  heldLength,
  heldPlacement,
  isDraftComplete,
  isOnGrid,
  offsetAlong,
  placedCount,
  returnHeld,
  rotateDraft,
  seatedShips,
  shipAtCell,
  shuffleDraft,
  takeShip,
  waitingShips,
  type FleetDraft,
} from '../src/view.ts';

/** Lays the whole fleet out down the left edge, one ship every other row. */
function tidyDraft(): FleetDraft {
  let draft = createDraft();
  for (const [index] of SHIP_LENGTHS.entries()) {
    draft = dropShip(takeShip(draft, index), index * 2, 0);
  }
  return draft;
}

describe('fitting one more ship', () => {
  it('accepts an empty board', () => {
    expect(fits([], { row: 0, column: 0, orientation: 'horizontal' }, 5)).toBe(true);
  });

  it('refuses a ship that would run off the edge', () => {
    expect(fits([], { row: 0, column: GRID_SIZE - 2, orientation: 'horizontal' }, 5)).toBe(false);
    expect(fits([], { row: GRID_SIZE - 2, column: 0, orientation: 'vertical' }, 5)).toBe(false);
  });

  it('refuses a ship crossing one already placed', () => {
    const placed = [{ placement: { row: 4, column: 0, orientation: 'horizontal' as const }, length: 5 }];

    expect(fits(placed, { row: 0, column: 2, orientation: 'vertical' }, 5)).toBe(false);
  });

  it('allows two ships to touch without overlapping', () => {
    const placed = [{ placement: { row: 0, column: 0, orientation: 'horizontal' as const }, length: 5 }];

    expect(fits(placed, { row: 1, column: 0, orientation: 'horizontal' }, 4)).toBe(true);
  });
});

describe('a random fleet', () => {
  it('is always legal', () => {
    for (let round = 0; round < 200; round += 1) {
      expect(checkFleet(randomFleet())).toBeNull();
    }
  });

  it('covers exactly the fleet', () => {
    expect(occupiedCells(randomFleet()).size).toBe(FLEET_CELLS);
  });

  it('starts over rather than returning a fleet with a hole in it', () => {
    // A generator that stands still asks for the same cell every time, so the
    // first ship is seated and the second can never be. That corner is the one
    // the restart exists for; once the values start moving again the run
    // completes, and what comes out is still a legal fleet rather than four
    // ships and a gap.
    let draws = 0;
    const stubborn = (): number => {
      draws += 1;
      return draws <= 1000 ? 0 : Math.random();
    };

    expect(checkFleet(randomFleet(stubborn))).toBeNull();
  });
});

describe('the ships themselves', () => {
  it('has a name for every length', () => {
    expect(SHIP_NAMES).toHaveLength(SHIP_LENGTHS.length);
    expect(shipName(0)).toBe('carrier');
    expect(shipName(SHIP_LENGTHS.length - 1)).toBe('destroyer');
  });

  it('answers for an index that is not a ship', () => {
    expect(shipName(99)).toBe('ship');
  });
});

describe('taking a ship in hand', () => {
  it('starts with every ship waiting and none held', () => {
    const draft = createDraft();

    expect(waitingShips(draft)).toEqual([0, 1, 2, 3, 4]);
    expect(draft.held).toBeNull();
    expect(heldLength(draft)).toBe(0);
  });

  it('takes a ship out of the tray without placing it', () => {
    const draft = takeShip(createDraft(), 2);

    expect(draft.held).toBe(2);
    expect(heldLength(draft)).toBe(SHIP_LENGTHS[2]);
    expect(waitingShips(draft)).toEqual([0, 1, 3, 4]);
    expect(placedCount(draft)).toBe(0);
  });

  it('picks a ship back up off the board, freeing the cells it held', () => {
    const placed = dropShip(takeShip(createDraft(), 0), 0, 0);
    expect(placedCount(placed)).toBe(1);

    const again = takeShip(placed, 0);

    expect(seatedShips(again)).toHaveLength(0);
    // Which is what lets it be put back exactly where it already was.
    expect(canDrop(again, 0, 0)).toBe(true);
  });

  it('ignores a ship that is not in the fleet', () => {
    const draft = createDraft();

    expect(takeShip(draft, -1)).toBe(draft);
    expect(takeShip(draft, 99)).toBe(draft);
  });

  it('clamps a grab beyond the ship it was made on', () => {
    // The destroyer is two cells long, so its last cell is index one.
    expect(takeShip(createDraft(), 4, 7).grabbedAt).toBe(1);
    expect(takeShip(createDraft(), 4, -3).grabbedAt).toBe(0);
  });
});

describe('carrying a ship by the cell it was grabbed by', () => {
  it('lands under the pointer, not five cells away', () => {
    // Taken hold of by its third cell and let go over C5: the ship must run
    // from C3 to C7, with C5 under the pointer.
    const draft = takeShip(createDraft(), 0, 2);

    expect(heldPlacement(draft, 2, 4)).toEqual({ row: 2, column: 2, orientation: 'horizontal' });
  });

  it('keeps the same cell under the pointer after a turn', () => {
    const turned = rotateDraft(takeShip(createDraft(), 0, 2));

    expect(heldPlacement(turned, 4, 2)).toEqual({ row: 2, column: 2, orientation: 'vertical' });
  });

  it('refuses a drop that would push the stern off the board', () => {
    const draft = takeShip(createDraft(), 0, 0);

    expect(canDrop(draft, 0, GRID_SIZE - 1)).toBe(false);
    expect(dropShip(draft, 0, GRID_SIZE - 1)).toBe(draft);
  });

  it('has nothing to place when no ship is held', () => {
    const empty = createDraft();

    expect(heldPlacement(empty, 0, 0)).toBeNull();
    expect(canDrop(empty, 0, 0)).toBe(false);
    expect(dropShip(empty, 0, 0)).toBe(empty);
  });
});

describe('a fleet being laid out', () => {
  it('is complete only once every slot is filled and nothing is in hand', () => {
    const tidy = tidyDraft();

    expect(isDraftComplete(tidy)).toBe(true);
    expect(checkFleet(draftFleet(tidy) ?? [])).toBeNull();
    // A ship taken back in hand is a fleet that is no longer ready to send.
    expect(isDraftComplete(takeShip(tidy, 3))).toBe(false);
    expect(draftFleet(takeShip(tidy, 3))).toBeNull();
  });

  it('sends its ships in fleet order however they were laid down', () => {
    // Placed backwards, from the destroyer to the carrier.
    let draft = createDraft();
    for (const index of [4, 3, 2, 1, 0]) {
      draft = dropShip(takeShip(draft, index), index * 2, 0);
    }

    const fleet = draftFleet(draft);

    expect(fleet).not.toBeNull();
    expect(checkFleet(fleet ?? [])).toBeNull();
    expect(fleet?.[0]).toEqual({ row: 0, column: 0, orientation: 'horizontal' });
    expect(fleet?.[4]).toEqual({ row: 8, column: 0, orientation: 'horizontal' });
  });

  it('does not renumber the ships when one is taken back', () => {
    const tidy = tidyDraft();

    // Take the cruiser, which is the third ship, and leave the rest alone.
    const missing = takeShip(tidy, 2);

    expect(waitingShips(missing)).toEqual([]);
    expect(missing.held).toBe(2);
    expect(missing.slots[3]).toEqual(tidy.slots[3]);
    expect(missing.slots[4]).toEqual(tidy.slots[4]);
  });

  it('turns the held ship a quarter turn', () => {
    const turned = rotateDraft(createDraft());

    expect(turned.orientation).toBe('vertical');
    expect(rotateDraft(turned).orientation).toBe('horizontal');
  });

  it('puts a held ship back in the tray', () => {
    const held = takeShip(createDraft(), 1);

    expect(returnHeld(held).held).toBeNull();
    expect(waitingShips(returnHeld(held))).toEqual([0, 1, 2, 3, 4]);
  });

  it('deals a complete legal fleet when shuffled', () => {
    const shuffled = shuffleDraft(takeShip(createDraft(), 0));

    expect(isDraftComplete(shuffled)).toBe(true);
    expect(shuffled.held).toBeNull();
    expect(checkFleet(draftFleet(shuffled) ?? [])).toBeNull();
  });

  it('empties the board back into the tray', () => {
    const cleared = clearDraft(tidyDraft());

    expect(placedCount(cleared)).toBe(0);
    expect(waitingShips(cleared)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('finding a ship on the board', () => {
  it('names the ship covering a cell', () => {
    const tidy = tidyDraft();

    expect(shipAtCell(tidy, 0, 3)).toBe(0);
    expect(shipAtCell(tidy, 8, 1)).toBe(4);
    expect(shipAtCell(tidy, 1, 0)).toBeNull();
  });

  it('says how far along a ship a cell falls', () => {
    const across = { row: 2, column: 3, orientation: 'horizontal' as const };
    const down = { row: 2, column: 3, orientation: 'vertical' as const };

    expect(offsetAlong(across, 2, 5)).toBe(2);
    expect(offsetAlong(down, 5, 3)).toBe(3);
  });
});

describe('reading the board', () => {
  it('knows which cells are on it', () => {
    expect(isOnGrid(0, 0)).toBe(true);
    expect(isOnGrid(GRID_SIZE - 1, GRID_SIZE - 1)).toBe(true);
    expect(isOnGrid(-1, 0)).toBe(false);
    expect(isOnGrid(0, GRID_SIZE)).toBe(false);
  });

  it('knows which cells have already been fired at', () => {
    const shots = [{ row: 2, column: 3, result: 'miss' as const }];

    expect(alreadyFired(shots, 2, 3)).toBe(true);
    expect(alreadyFired(shots, 3, 2)).toBe(false);
  });
});
