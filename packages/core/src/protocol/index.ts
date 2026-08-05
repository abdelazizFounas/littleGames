/**
 * The shared match protocol, generated from
 * `packages/core/proto/littlegames/match/v1/match.proto`.
 *
 * Types only, with no runtime import of any kind, so that game logic can
 * depend on the protocol and still run in a bare Node process. The wire codec
 * lives in `@littlegames/net`, next to the socket that needs it.
 */
export type { PlayerInput, PlayerState, Snapshot } from './generated/littlegames/match/v1/match';
export { OpCode } from './generated/littlegames/match/v1/match';
