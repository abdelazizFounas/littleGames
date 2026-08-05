import type { Client, Session, Socket } from '@heroiclabs/nakama-js';
import { OpCode, type PlayerInput, type Snapshot } from '@littlegames/core';
import type { NakamaConfig } from './config';
import {
  PlayerInput as PlayerInputCodec,
  Snapshot as SnapshotCodec,
} from './protocol/generated/littlegames/match/v1/match';

/** Server function that hands back a match with room to spare. */
const FIND_MATCH_RPC = 'match.find';

/** Where the connection to a match stands. */
export type ConnectionState =
  /** Connected and receiving. */
  | 'live'
  /** Dropped, and trying to get back in. */
  | 'reconnecting'
  /** Given up. Nothing further will arrive. */
  | 'lost';

/** What a joined match reports back to the screen driving it. */
export interface MatchListeners {
  /** A new authoritative state arrived. Fires once per server tick. */
  onSnapshot: (snapshot: Snapshot) => void;
  /**
   * The connection changed.
   *
   * A return to `live` after `reconnecting` means the socket was rebuilt: what
   * was buffered before it dropped describes a match that has moved on, and
   * has to be discarded rather than blended with what arrives now.
   */
  onConnectionChange: (state: ConnectionState) => void;
  /** Something arrived that could not be handled. */
  onError: (error: unknown) => void;
}

/**
 * Backoff between attempts to get back in, in milliseconds.
 *
 * It starts short because most drops are momentary — a tunnel, a handover from
 * Wi-Fi to mobile data — and grows because one that is not momentary should not
 * be met with a flood of attempts.
 */
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 8000, 8000];

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
export async function findMatch(
  client: Client,
  session: Session,
  fresh = false,
): Promise<string> {
  const response = await client.rpc(session, FIND_MATCH_RPC, fresh ? { fresh: true } : {});
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
  let socket: Socket = client.createSocket(config.useSSL);
  let leaving = false;
  let attempt = 0;

  const attach = (target: Socket): void => {
    target.onmatchdata = (matchData) => {
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

    target.ondisconnect = () => {
      if (leaving) {
        return;
      }
      listeners.onConnectionChange('reconnecting');
      void reconnect();
    };

    // The Nakama socket is not an EventTarget: it exposes assignable `on*`
    // properties and no addEventListener, so this is the only way to observe it.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    target.onerror = (event) => {
      listeners.onError(event);
    };
  };

  /**
   * Rebuilds the socket and takes the seat back.
   *
   * The seat survives because the server lets a player return on a new socket,
   * which is what makes a handover between networks a pause rather than a
   * forfeit.
   */
  const reconnect = async (): Promise<void> => {
    // `leaving` is set from outside, by a caller that decided to stop while an
    // attempt was in flight. Observing it here is the whole point of the flag.
    // oxlint-disable-next-line eslint/no-unmodified-loop-condition
    while (!leaving && attempt < RECONNECT_DELAYS_MS.length) {
      const delay = RECONNECT_DELAYS_MS[attempt] ?? 8000;
      attempt += 1;
      // Sequential on purpose: each attempt must wait out its own backoff and
      // learn whether it worked before the next is considered. Running them
      // together would be the flood the backoff exists to prevent.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (leaving) {
        return;
      }
      try {
        const replacement = client.createSocket(config.useSSL);
        attach(replacement);
        // oxlint-disable-next-line eslint/no-await-in-loop
        await replacement.connect(session, false);
        // oxlint-disable-next-line eslint/no-await-in-loop
        await replacement.joinMatch(matchId);
        socket = replacement;
        attempt = 0;
        listeners.onConnectionChange('live');
        return;
      } catch {
        // Kept quiet on purpose: a failed attempt is expected while the network
        // is still down, and reporting each one would bury the one outcome that
        // matters.
      }
    }
    if (!leaving) {
      listeners.onConnectionChange('lost');
    }
  };

  attach(socket);
  // `false` keeps the player out of the global status feed: presence inside a
  // match is tracked by the match itself.
  await socket.connect(session, false);
  await socket.joinMatch(matchId);
  listeners.onConnectionChange('live');

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
      leaving = true;
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

/** A code that leads to a match, and how long it stays good for. */
export interface Invitation {
  readonly code: string;
  readonly matchId: string;
  /** Unix seconds after which the code stops working. */
  readonly expiresAt: number;
}

/**
 * Opens a match and asks the server for a code that leads to it.
 *
 * The code is drawn server-side from a cryptographic source: a predictable one
 * would let anyone walk into a private match by guessing the next.
 */
export async function createInvitation(
  client: Client,
  session: Session,
  matchId?: string,
): Promise<Invitation> {
  const response = await client.rpc(session, 'invite.create', matchId === undefined ? {} : { matchId });
  const payload: unknown = response.payload;

  if (
    !isRecord(payload) ||
    typeof payload['code'] !== 'string' ||
    typeof payload['matchId'] !== 'string' ||
    typeof payload['expiresAt'] !== 'number'
  ) {
    throw new Error('The server did not return an invitation.');
  }

  return { code: payload['code'], matchId: payload['matchId'], expiresAt: payload['expiresAt'] };
}

/**
 * Turns an invitation code back into the match it points at.
 *
 * The server distinguishes an unknown code from an expired one, and the message
 * it sends back is meant to be shown as-is: a player who followed a stale link
 * needs to know to ask for a new one, not to hunt for a typo.
 */
export async function resolveInvitation(
  client: Client,
  session: Session,
  code: string,
): Promise<string> {
  const response = await client.rpc(session, 'invite.resolve', { code });
  const payload: unknown = response.payload;

  if (!isRecord(payload) || typeof payload['matchId'] !== 'string') {
    throw new Error('That invitation could not be resolved.');
  }
  return payload['matchId'];
}
