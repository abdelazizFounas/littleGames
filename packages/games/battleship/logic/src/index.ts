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
export { createInitialState, opponentOf, shipLength, startPlacement } from './state.ts';
export type { PlacementProblem } from './placement.ts';
export { cellsOf, checkFleet, occupiedCells } from './placement.ts';
export type { ActionProblem } from './shots.ts';
export { fire, placeFleet, sunkCount } from './shots.ts';
