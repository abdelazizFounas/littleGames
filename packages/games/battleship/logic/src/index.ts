export * from './constants.ts';
export type {
  BattleshipState,
  Board,
  Orientation,
  Phase,
  Placement,
  Shot,
  ShotResult,
  Side,
} from './state.ts';
export { createInitialState, opponentOf, shipLength, shipName, startPlacement } from './state.ts';
export type { PlacementProblem, SeatedShip } from './placement.ts';
export {
  cellsOf,
  cellsTakenBy,
  checkFleet,
  fits,
  occupiedCells,
  randomFleet,
} from './placement.ts';
export type { ActionProblem } from './shots.ts';
export { fire, placeFleet, sunkCount } from './shots.ts';
export type { BattleshipView, FleetDraft, MarkedShot } from './view.ts';
export {
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
} from './view.ts';
