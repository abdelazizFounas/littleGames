import type { Client, Session, Socket } from '@heroiclabs/nakama-js';
import type { NakamaConfig } from './config';

/** Where the connection to a match stands. */
export type ConnectionState =
  /** Connected and receiving. */
  | 'live'
  /** Dropped, and trying to get back in. */
  | 'reconnecting'
  /** Given up. Nothing further will arrive. */
  | 'lost';

/**
 * Backoff between attempts to get back in, in milliseconds.
 *
 * It starts short because most drops are momentary — a tunnel, a handover from
 * Wi-Fi to mobile data — and grows because one that is not momentary should not
 * be met with a flood of attempts.
 */
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 8000, 8000];

/** What a match socket reports back, before any game has interpreted it. */
export interface MatchSocketListeners {
  /** A frame arrived. The op code says which game message it is. */
  onData: (opCode: number, data: Uint8Array) => void;
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

/** A socket sitting in a match, with no opinion about what is played on it. */
export interface MatchSocket {
  readonly matchId: string;
  send: (opCode: number, data: Uint8Array) => Promise<void>;
  /** Leaves the match and closes the socket. */
  leave: () => Promise<void>;
}

/**
 * Opens a socket, joins the given match, and keeps it there.
 *
 * Every game shares this: taking a seat, holding it through a dropped
 * connection, and giving it up on the way out are properties of the platform
 * and not of any game played on it. What travels over it is bytes and an op
 * code, which each game reads with its own protocol.
 *
 * The socket is owned by the returned handle and closed when it leaves, so a
 * screen that mounts and unmounts cannot leak one.
 */
export async function openMatchSocket(
  client: Client,
  config: NakamaConfig,
  session: Session,
  matchId: string,
  listeners: MatchSocketListeners,
  password = '',
): Promise<MatchSocket> {
  let socket: Socket = client.createSocket(config.useSSL);
  let leaving = false;
  let attempt = 0;

  const attach = (target: Socket): void => {
    target.onmatchdata = (matchData) => {
      listeners.onData(matchData.op_code, matchData.data);
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
        await replacement.joinMatch(matchId, undefined, password === '' ? undefined : { password });
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
  await socket.joinMatch(matchId, undefined, password === '' ? undefined : { password });
  listeners.onConnectionChange('live');

  return {
    matchId,
    send: async (opCode, data) => {
      await socket.sendMatchState(matchId, opCode, data);
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
