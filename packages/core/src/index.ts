export type { GameRenderer } from './rendering/game-renderer';
export type { InputCommand } from './input/input-command';
export type { InputSource } from './input/input-source';

export type { PlayerInput, PlayerState, Snapshot } from './protocol';
export { OpCode } from './protocol';

export type {
  BattleshipFire,
  BattleshipPlaceFleet,
  BattleshipPlacement,
  BattleshipRefused,
  BattleshipShot,
  BattleshipSnapshot,
} from './protocol';
export {
  BattleshipOpCode,
  BattleshipOrientation,
  BattleshipPhase,
  BattleshipShotResult,
} from './protocol';
