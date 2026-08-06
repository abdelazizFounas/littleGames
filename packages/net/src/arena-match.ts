import type { Client, Session } from '@heroiclabs/nakama-js';
import { ArenaOpCode, type ArenaPlayerInput, type ArenaSnapshot } from '@littlegames/core';
import type { NakamaConfig } from './config';
import { openMatchSocket, type ConnectionState } from './match-socket';
import {
  PlayerInput as PlayerInputCodec,
  Snapshot as SnapshotCodec,
} from './protocol/generated/littlegames/arena/v1/arena';

/** What a joined Arena match reports back to the screen driving it. */
export interface ArenaMatchListeners {
  /**
   * A new authoritative state arrived. Fires once per server tick.
   *
   * It carries both bodies whole — position, vertical speed and crouch — because
   * it is where the client's prediction of its own body restarts from, and a
   * body missing its vertical speed would be put back on the ground mid-jump.
   */
  onSnapshot: (snapshot: ArenaSnapshot) => void;
  /**
   * The connection changed.
   *
   * A return to `live` after `reconnecting` means the socket was rebuilt: what
   * was buffered before it dropped describes a match that has moved on, and has
   * to be discarded rather than blended with what arrives now.
   */
  onConnectionChange: (state: ConnectionState) => void;
  /** Something arrived that could not be handled. */
  onError: (error: unknown) => void;
}

/** A live Arena match, from the client's side. */
export interface ArenaConnection {
  readonly matchId: string;
  /**
   * Sends one tick of intent.
   *
   * Quantised by the caller, not here: the client predicts from the very
   * integers it puts on the wire rather than from the floats it computed them
   * out of, so the rounding has to happen before the command is kept for
   * replay. This package carries it; it does not decide what it means.
   */
  sendInput: (input: ArenaPlayerInput) => Promise<void>;
  /** Leaves the match and closes the socket. */
  leave: () => Promise<void>;
}

/**
 * Opens a socket and joins the given Arena match.
 *
 * The socket, the backoff and the seat are the platform's, shared with every
 * other game; what differs here is only which messages travel over it.
 */
export async function joinArenaMatch(
  client: Client,
  config: NakamaConfig,
  session: Session,
  matchId: string,
  listeners: ArenaMatchListeners,
  password = '',
): Promise<ArenaConnection> {
  const socket = await openMatchSocket(
    client,
    config,
    session,
    matchId,
    {
      onData: (opCode, data) => {
        if (opCode !== ArenaOpCode.OP_CODE_SNAPSHOT) {
          return;
        }
        try {
          listeners.onSnapshot(SnapshotCodec.decode(data));
        } catch (cause) {
          // A frame we cannot decode means client and server disagree about the
          // protocol. Reporting it beats rendering a silently empty match.
          listeners.onError(cause);
        }
      },
      onConnectionChange: listeners.onConnectionChange,
      onError: listeners.onError,
    },
    password,
  );

  return {
    matchId: socket.matchId,
    sendInput: async (input) => {
      await socket.send(ArenaOpCode.OP_CODE_PLAYER_INPUT, PlayerInputCodec.encode(input).finish());
    },
    leave: socket.leave,
  };
}
