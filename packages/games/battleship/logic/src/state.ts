import { FLEET_SIZE, SHIP_LENGTHS, SHIP_NAMES } from './constants.ts';

/** Which of the two seats a player holds. */
export type Side = 'a' | 'b';

export type Orientation = 'horizontal' | 'vertical';

/** Where one ship sits. Its length comes from its index in the fleet. */
export interface Placement {
  readonly row: number;
  readonly column: number;
  readonly orientation: Orientation;
}

/** A cell someone fired at. */
export interface Shot {
  readonly row: number;
  readonly column: number;
}

/** What a shot found. */
export type ShotResult = 'miss' | 'hit' | 'sunk';

export interface Board {
  /** Empty until the fleet is placed and confirmed. */
  readonly fleet: readonly Placement[];
  /** True once this player has confirmed their placement. */
  readonly ready: boolean;
  /** Cells the opponent has fired at these waters, oldest first. */
  readonly incoming: readonly Shot[];
}

export type Phase = 'waiting' | 'placement' | 'playing' | 'finished';

export interface BattleshipState {
  readonly phase: Phase;
  /** Whose turn it is to fire. Meaningless outside `playing`. */
  readonly turn: Side;
  readonly boards: { readonly a: Board; readonly b: Board };
  readonly winner: Side | null;
}

const EMPTY_BOARD: Board = { fleet: [], ready: false, incoming: [] };

export function createInitialState(): BattleshipState {
  return {
    phase: 'waiting',
    // Whoever holds seat A opens. Fixed rather than drawn, so the server and
    // every client agree without exchanging anything.
    turn: 'a',
    boards: { a: EMPTY_BOARD, b: EMPTY_BOARD },
    winner: null,
  };
}

/** Moves a waiting match into placement, once both seats are filled. */
export function startPlacement(state: BattleshipState): BattleshipState {
  return state.phase === 'waiting' ? { ...state, phase: 'placement' } : state;
}

export function opponentOf(side: Side): Side {
  return side === 'a' ? 'b' : 'a';
}

/** Length of the ship at a given index in the fleet. */
export function shipLength(index: number): number {
  return SHIP_LENGTHS[index] ?? 0;
}

/** What the ship at a given index in the fleet is called. */
export function shipName(index: number): string {
  return SHIP_NAMES[index] ?? 'ship';
}

export { FLEET_SIZE };
