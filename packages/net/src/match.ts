import type { Client, Session } from '@heroiclabs/nakama-js';
import { OpCode, type PlayerInput, type Snapshot } from '@littlegames/core';
import type { NakamaConfig } from './config';
import { openMatchSocket, type ConnectionState } from './match-socket';
import {
  PlayerInput as PlayerInputCodec,
  Snapshot as SnapshotCodec,
} from './protocol/generated/littlegames/match/v1/match';

/** What a joined Pong match reports back to the screen driving it. */
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

/** A live Pong match, from the client's side. */
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
 * Opens a socket and joins the given Pong match.
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
  password = '',
): Promise<MatchConnection> {
  const socket = await openMatchSocket(
    client,
    config,
    session,
    matchId,
    {
      onData: (opCode, data) => {
        if (opCode !== OpCode.OP_CODE_SNAPSHOT) {
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
      await socket.send(OpCode.OP_CODE_PLAYER_INPUT, PlayerInputCodec.encode(input).finish());
    },
    leave: socket.leave,
  };
}

/** A lobby waiting for an opponent, as the listing describes it. */
export interface LobbySummary {
  readonly matchId: string;
  readonly host: string;
  readonly locked: boolean;
  readonly players: number;
}

function matchIdOf(payload: unknown): string {
  if (!isRecord(payload) || typeof payload['matchId'] !== 'string') {
    throw new Error('The server did not return a lobby.');
  }
  return payload['matchId'];
}

/** Joins the first open lobby with room, or opens one when there is none. */
export async function autoLobby(
  client: Client,
  session: Session,
  game: string,
): Promise<string> {
  return matchIdOf((await client.rpc(session, 'lobby.auto', { game })).payload);
}

/** Opens a lobby. An empty password means anyone may walk in. */
export async function createLobby(
  client: Client,
  session: Session,
  game: string,
  password: string,
): Promise<string> {
  return matchIdOf((await client.rpc(session, 'lobby.create', { game, password })).payload);
}

/**
 * Lists the lobbies still waiting for an opponent.
 *
 * Locked ones are included: knowing a game is there and needing a password to
 * enter is the point. The password itself is never part of this.
 */
export async function listLobbies(
  client: Client,
  session: Session,
  game: string,
): Promise<LobbySummary[]> {
  const payload: unknown = (await client.rpc(session, 'lobby.list', { game })).payload;
  if (!isRecord(payload) || !Array.isArray(payload['lobbies'])) {
    return [];
  }
  return payload['lobbies'].flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry['matchId'] !== 'string') {
      return [];
    }
    return [
      {
        matchId: entry['matchId'],
        host: typeof entry['host'] === 'string' ? entry['host'] : 'someone',
        locked: entry['locked'] === true,
        players: typeof entry['players'] === 'number' ? entry['players'] : 0,
      },
    ];
  });
}

/**
 * Asks whether a password would be accepted, without joining.
 *
 * So a wrong one is refused on the screen the player is already on, rather than
 * after a game screen has been built for a match they cannot enter. Throws with
 * the server's own words when it would not be.
 */
export async function checkLobby(
  client: Client,
  session: Session,
  matchId: string,
  password: string,
): Promise<void> {
  await client.rpc(session, 'lobby.check', { matchId, password });
}

/** A match this player belongs to and can go back into. */
export interface ResumableMatch {
  readonly matchId: string;
  readonly game: string;
  readonly host: string;
  /** Carried so a locked lobby can be re-entered without asking again. */
  readonly password: string;
  readonly players: number;
}

/**
 * Lists the matches this player can return to.
 *
 * The server checks each one still exists before offering it, so a game that
 * ended while the player was away never appears as a door onto nothing.
 */
export async function listMyMatches(client: Client, session: Session): Promise<ResumableMatch[]> {
  const payload: unknown = (await client.rpc(session, 'lobby.mine', {})).payload;
  if (!isRecord(payload) || !Array.isArray(payload['matches'])) {
    return [];
  }
  return payload['matches'].flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry['matchId'] !== 'string') {
      return [];
    }
    return [
      {
        matchId: entry['matchId'],
        game: typeof entry['game'] === 'string' ? entry['game'] : 'pong',
        host: typeof entry['host'] === 'string' ? entry['host'] : 'someone',
        password: typeof entry['password'] === 'string' ? entry['password'] : '',
        players: typeof entry['players'] === 'number' ? entry['players'] : 0,
      },
    ];
  });
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
): Promise<{ readonly matchId: string; readonly password: string }> {
  const payload: unknown = (await client.rpc(session, 'invite.resolve', { code })).payload;

  if (!isRecord(payload) || typeof payload['matchId'] !== 'string') {
    throw new Error('That invitation could not be resolved.');
  }
  // The link carries the password: the host chose to let this person in, so
  // asking them for it separately would defeat the invitation.
  return {
    matchId: payload['matchId'],
    password: typeof payload['password'] === 'string' ? payload['password'] : '',
  };
}
