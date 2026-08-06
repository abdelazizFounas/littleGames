import type { Client, Session } from '@heroiclabs/nakama-js';
import {
  BattleshipOpCode,
  type BattleshipPlacement,
  type BattleshipSnapshot,
} from '@littlegames/core';
import type { NakamaConfig } from './config';
import { openMatchSocket, type ConnectionState } from './match-socket';
import {
  Fire as FireCodec,
  PlaceFleet as PlaceFleetCodec,
  Refused as RefusedCodec,
  Snapshot as SnapshotCodec,
} from './protocol/generated/littlegames/battleship/v1/battleship';

/** What a joined Battleship match reports back to the screen driving it. */
export interface BattleshipMatchListeners {
  /**
   * A new authoritative state arrived, built for this recipient alone.
   *
   * It carries this player's own fleet and, of the opponent's waters, nothing
   * but the cells this player has already fired at. There is no hidden half to
   * uncover: the answer never leaves the server.
   */
  onSnapshot: (snapshot: BattleshipSnapshot) => void;
  /** The server turned an action down, in words meant to be shown. */
  onRefused: (reason: string) => void;
  onConnectionChange: (state: ConnectionState) => void;
  onError: (error: unknown) => void;
}

/** A live Battleship match, from the client's side. */
export interface BattleshipConnection {
  readonly matchId: string;
  /** Confirms the whole fleet at once; the server checks it again. */
  placeFleet: (ships: readonly BattleshipPlacement[]) => Promise<void>;
  /** Fires at a cell of the opponent's waters. */
  fire: (row: number, column: number) => Promise<void>;
  /** Leaves the match and closes the socket. */
  leave: () => Promise<void>;
}

/**
 * Opens a socket and joins the given Battleship match.
 *
 * The socket, the backoff and the seat are the platform's, shared with every
 * other game; what differs here is only which messages travel over it.
 */
export async function joinBattleshipMatch(
  client: Client,
  config: NakamaConfig,
  session: Session,
  matchId: string,
  listeners: BattleshipMatchListeners,
  password = '',
): Promise<BattleshipConnection> {
  const socket = await openMatchSocket(
    client,
    config,
    session,
    matchId,
    {
      onData: (opCode, data) => {
        try {
          if (opCode === BattleshipOpCode.OP_CODE_SNAPSHOT) {
            listeners.onSnapshot(SnapshotCodec.decode(data));
            return;
          }
          if (opCode === BattleshipOpCode.OP_CODE_REFUSED) {
            listeners.onRefused(RefusedCodec.decode(data).reason);
          }
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
    placeFleet: async (ships) => {
      await socket.send(
        BattleshipOpCode.OP_CODE_PLACE_FLEET,
        PlaceFleetCodec.encode({ ships: [...ships] }).finish(),
      );
    },
    fire: async (row, column) => {
      await socket.send(BattleshipOpCode.OP_CODE_FIRE, FireCodec.encode({ row, column }).finish());
    },
    leave: socket.leave,
  };
}
