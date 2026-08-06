/**
 * The shared match protocols, generated from the files under
 * `packages/core/proto/littlegames/`.
 *
 * Types only, with no runtime import of any kind, so that game logic can
 * depend on the protocol and still run in a bare Node process. The wire codec
 * lives in `@littlegames/net`, next to the socket that needs it.
 *
 * Each game brings its own protocol, and every one of them names its messages
 * `Snapshot` and its op codes `OpCode`. They are prefixed on the way out, so a
 * file that talks to both games can name both without aliasing either.
 */
export type { PlayerInput, PlayerState, Snapshot } from './generated/littlegames/match/v1/match';
export { OpCode } from './generated/littlegames/match/v1/match';

export type {
  Fire as BattleshipFire,
  PlaceFleet as BattleshipPlaceFleet,
  Placement as BattleshipPlacement,
  Refused as BattleshipRefused,
  Shot as BattleshipShot,
  Snapshot as BattleshipSnapshot,
} from './generated/littlegames/battleship/v1/battleship';
export {
  OpCode as BattleshipOpCode,
  Orientation as BattleshipOrientation,
  Phase as BattleshipPhase,
  ShotResult as BattleshipShotResult,
} from './generated/littlegames/battleship/v1/battleship';

export type {
  Body as ArenaBody,
  PlayerInput as ArenaPlayerInput,
  PlayerState as ArenaPlayerState,
  ShotEvent as ArenaShotEvent,
  Snapshot as ArenaSnapshot,
  Vector3 as ArenaVector3,
} from './generated/littlegames/arena/v1/arena';
export {
  OpCode as ArenaOpCode,
  Phase as ArenaPhase,
  Seat as ArenaSeat,
} from './generated/littlegames/arena/v1/arena';
