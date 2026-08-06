import { FLEET_SIZE, GRID_SIZE } from './constants.ts';
import { cellsOf, fits, randomFleet, type SeatedShip } from './placement.ts';
import { shipLength, type Orientation, type Placement, type ShotResult } from './state.ts';

/**
 * What one player knows, and everything a screen needs to draw it.
 *
 * Deliberately not `BattleshipState`. The server holds both fleets; a client is
 * sent its own in full and, of the opponent's waters, nothing but the cells it
 * has already fired at. That asymmetry is the point of the game, so the shape a
 * client works with says out loud that half the board is not in it.
 *
 * It lives with the rules rather than with the renderer because it is plain
 * data with no engine in it: a second renderer would draw the same thing, and a
 * test can build one by hand.
 */

/** A cell someone fired at, and what it found. */
export interface MarkedShot {
  readonly row: number;
  readonly column: number;
  readonly result: ShotResult;
}

/**
 * A fleet being laid out, before it is confirmed.
 *
 * Local to the player arranging it: nothing here has been sent anywhere, and
 * the server has no idea it exists until it is complete and confirmed.
 *
 * One slot per ship, in fleet order, so a slot's index is the ship's identity
 * and gives both its length and its name. Ships can therefore be laid down,
 * picked back up and laid down again in any order, which a plain growing list
 * could not express — with a list, taking back the third ship would silently
 * turn the fourth into the third.
 */
export interface FleetDraft {
  /** Where each ship sits, or nothing while it is still waiting to be placed. */
  readonly slots: readonly (Placement | null)[];
  /** Which ship is in hand, or none. */
  readonly held: number | null;
  /** Which cell along the held ship the pointer took hold of, from the stern. */
  readonly grabbedAt: number;
  /** Which way the held ship lies. */
  readonly orientation: Orientation;
}

export interface BattleshipView {
  readonly phase: 'waiting' | 'placement' | 'playing' | 'finished';
  /** True when it is this player's turn to fire. */
  readonly yourTurn: boolean;
  /** This player's own ships, once confirmed. Empty while still placing. */
  readonly yourFleet: readonly Placement[];
  /** Every shot taken at these waters. */
  readonly incoming: readonly MarkedShot[];
  /** Every shot this player has taken at the opponent's. Never more. */
  readonly outgoing: readonly MarkedShot[];
  readonly youAreReady: boolean;
  readonly opponentReady: boolean;
  readonly opponentPresent: boolean;
  readonly yourShipsSunk: number;
  readonly opponentShipsSunk: number;
  readonly finished: boolean;
  readonly youWon: boolean;
  /** The fleet this player is arranging, while they are arranging one. */
  readonly draft: FleetDraft | null;
  /**
   * Where the pointer rests, in the drawing surface's own pixels.
   *
   * Pixels rather than a cell, because a ship in hand has to follow the pointer
   * across the gap between the board and the tray, where there is no cell to
   * name. Turning it into a cell is the renderer's job: it owns the geometry,
   * and only one place may.
   */
  readonly pointer: { readonly x: number; readonly y: number } | null;
}

export function createDraft(): FleetDraft {
  return {
    slots: Array.from({ length: FLEET_SIZE }, () => null),
    held: null,
    grabbedAt: 0,
    orientation: 'horizontal',
  };
}

/** Length of the ship in hand, or zero when there is none. */
export function heldLength(draft: FleetDraft): number {
  return draft.held === null ? 0 : shipLength(draft.held);
}

/** The ships already on the board, each carrying its own length. */
export function seatedShips(draft: FleetDraft): SeatedShip[] {
  const ships: SeatedShip[] = [];
  for (const [index, placement] of draft.slots.entries()) {
    if (placement !== null) {
      ships.push({ placement, length: shipLength(index) });
    }
  }
  return ships;
}

/** Which ships are still waiting in the tray, neither placed nor in hand. */
export function waitingShips(draft: FleetDraft): number[] {
  const waiting: number[] = [];
  for (const [index, placement] of draft.slots.entries()) {
    if (placement === null && index !== draft.held) {
      waiting.push(index);
    }
  }
  return waiting;
}

/**
 * Where the held ship would sit if it were let go over this cell.
 *
 * The cell under the pointer is not the ship's bow: it is whichever cell of the
 * ship was taken hold of. Carrying a five-cell ship by its middle and having it
 * land five cells away is the sort of thing that makes a placement screen feel
 * like it is fighting you.
 */
export function heldPlacement(draft: FleetDraft, row: number, column: number): Placement | null {
  if (draft.held === null) {
    return null;
  }
  const offset = Math.min(Math.max(draft.grabbedAt, 0), heldLength(draft) - 1);
  return draft.orientation === 'horizontal'
    ? { row, column: column - offset, orientation: 'horizontal' }
    : { row: row - offset, column, orientation: 'vertical' };
}

/** Whether the held ship would be legal if let go over this cell. */
export function canDrop(draft: FleetDraft, row: number, column: number): boolean {
  const placement = heldPlacement(draft, row, column);
  return placement !== null && fits(seatedShips(draft), placement, heldLength(draft));
}

/**
 * Takes a ship in hand, from the tray or back off the board.
 *
 * A ship already down leaves its slot empty, so the arrangement it was part of
 * stops counting it immediately — which is what lets it be dropped back where
 * it already was.
 */
export function takeShip(draft: FleetDraft, index: number, grabbedAt = 0): FleetDraft {
  if (index < 0 || index >= FLEET_SIZE) {
    return draft;
  }
  const slots = [...draft.slots];
  slots[index] = null;
  return {
    ...draft,
    slots,
    held: index,
    grabbedAt: Math.min(Math.max(grabbedAt, 0), shipLength(index) - 1),
  };
}

/** Lets the held ship go. An illegal cell leaves the draft exactly as it was. */
export function dropShip(draft: FleetDraft, row: number, column: number): FleetDraft {
  const placement = heldPlacement(draft, row, column);
  if (draft.held === null || placement === null) {
    return draft;
  }
  if (!fits(seatedShips(draft), placement, heldLength(draft))) {
    return draft;
  }
  const slots = [...draft.slots];
  slots[draft.held] = placement;
  return { ...draft, slots, held: null, grabbedAt: 0 };
}

/** Puts the held ship back in the tray, wherever the pointer happens to be. */
export function returnHeld(draft: FleetDraft): FleetDraft {
  return draft.held === null ? draft : { ...draft, held: null, grabbedAt: 0 };
}

/** Which ship covers a cell, if one does. */
export function shipAtCell(draft: FleetDraft, row: number, column: number): number | null {
  for (const [index, placement] of draft.slots.entries()) {
    if (placement === null) {
      continue;
    }
    if (
      cellsOf(placement, shipLength(index)).some(
        (cell) => cell.row === row && cell.column === column,
      )
    ) {
      return index;
    }
  }
  return null;
}

/** How far along a ship a cell falls, counting from its stern. */
export function offsetAlong(placement: Placement, row: number, column: number): number {
  return placement.orientation === 'horizontal' ? column - placement.column : row - placement.row;
}

/** Turns the held ship a quarter turn, keeping the same cell under the pointer. */
export function rotateDraft(draft: FleetDraft): FleetDraft {
  return {
    ...draft,
    orientation: draft.orientation === 'horizontal' ? 'vertical' : 'horizontal',
  };
}

/** Throws the arrangement away and deals a fresh legal one. */
export function shuffleDraft(draft: FleetDraft, random?: () => number): FleetDraft {
  return { ...draft, slots: randomFleet(random), held: null, grabbedAt: 0 };
}

/** Clears the board and puts every ship back in the tray. */
export function clearDraft(draft: FleetDraft): FleetDraft {
  return { ...draft, slots: createDraft().slots, held: null, grabbedAt: 0 };
}

export function placedCount(draft: FleetDraft): number {
  return draft.slots.filter((placement) => placement !== null).length;
}

export function isDraftComplete(draft: FleetDraft): boolean {
  return draft.held === null && placedCount(draft) === FLEET_SIZE;
}

/**
 * The fleet as the server expects it: every ship, in fleet order.
 *
 * Null while the arrangement is unfinished, so a half-built fleet has no way of
 * being sent by accident.
 */
export function draftFleet(draft: FleetDraft): Placement[] | null {
  if (!isDraftComplete(draft)) {
    return null;
  }
  const fleet: Placement[] = [];
  for (const placement of draft.slots) {
    if (placement === null) {
      return null;
    }
    fleet.push(placement);
  }
  return fleet;
}

/** Whether a cell has already been fired at, so a second click is wasted. */
export function alreadyFired(shots: readonly MarkedShot[], row: number, column: number): boolean {
  return shots.some((shot) => shot.row === row && shot.column === column);
}

export function isOnGrid(row: number, column: number): boolean {
  return row >= 0 && row < GRID_SIZE && column >= 0 && column < GRID_SIZE;
}
