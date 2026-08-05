import type { Client, Session, Socket } from '@heroiclabs/nakama-js';
import { OpCode, type PlayerInput, type Snapshot } from '@littlegames/core';
import type { NakamaConfig } from './config';
import {
  PlayerInput as PlayerInputCodec,
  Snapshot as SnapshotCodec,
} from './protocol/generated/littlegames/match/v1/match';

/** Server function that hands back a match with room to spare. */
const FIND_MATCH_RPC = 'match.find';

/** What a joined match reports back to the screen driving it. */
export interface MatchListeners {
  /** A new authoritative state arrived. Fires once per server tick. */
  onSnapshot: (snapshot: Snapshot) => void;
  /** The socket closed, expectedly or not. */
  onDisconnect: () => void;
  /** Something arrived that could not be handled. */
  onError: (error: unknown) => void;
}

/** A live match, from the client's side. */
export interface MatchConnection {
  readonly matchId: string;
  /** Sends what this player is pressing. Intent only, never a position. */
  sendInput: (input: PlayerInput) => Promise<void>;
  /** Leaves the match and closes the socket. */
  leave: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Asks the server for a match to play in.
 *
 * The id comes from the server rather than the client, because a client that
 * could name its own match could drop itself into somebody else's game.
 */
export async function findMatch(client: Client, session: Session): Promise<string> {
  const response = await client.rpc(session, FIND_MATCH_RPC, {});
  const payload: unknown = response.payload;

  if (!isRecord(payload) || typeof payload['matchId'] !== 'string') {
    throw new Error('The server did not return a match id.');
  }

  return payload['matchId'];
}

/**
 * Opens a socket and joins the given match.
 *
 * The socket is owned by the returned connection and closed when it leaves, so
 * a screen that mounts and unmounts cannot leak one.
 */
export async function joinMatch(
  client: Client,
  config: NakamaConfig,
  session: Session,
  matchId: string,
  listeners: MatchListeners,
): Promise<MatchConnection> {
  const socket: Socket = client.createSocket(config.useSSL);

  socket.onmatchdata = (matchData) => {
    if (matchData.op_code !== OpCode.OP_CODE_SNAPSHOT) {
      return;
    }
    try {
      listeners.onSnapshot(SnapshotCodec.decode(matchData.data));
    } catch (cause) {
      // A frame we cannot decode means client and server disagree about the
      // protocol. Reporting it beats rendering a silently empty match.
      listeners.onError(cause);
    }
  };

  socket.ondisconnect = () => {
    listeners.onDisconnect();
  };

  // The Nakama socket is not an EventTarget: it exposes assignable `on*`
  // properties and no addEventListener, so this is the only way to observe it.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  socket.onerror = (event) => {
    listeners.onError(event);
  };

  // `false` keeps the player out of the global status feed: presence inside a
  // match is tracked by the match itself.
  await socket.connect(session, false);
  await socket.joinMatch(matchId);

  return {
    matchId,
    sendInput: async (input) => {
      await socket.sendMatchState(
        matchId,
        OpCode.OP_CODE_PLAYER_INPUT,
        PlayerInputCodec.encode(input).finish(),
      );
    },
    leave: async () => {
      try {
        await socket.leaveMatch(matchId);
      } finally {
        // Closing without firing the disconnect event: this departure is
        // deliberate, and the screen already knows it is leaving.
        socket.disconnect(false);
      }
    },
  };
}
