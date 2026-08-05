import type {
  GameSummary,
  Invitation,
  LeaderboardEntry,
  LobbySummary,
  MatchConnection,
  MatchListeners,
  PlayerProfile,
  PlayerStats,
} from '@littlegames/net';
import { createContext } from 'react';

/**
 * Whether anyone is signed in, and who.
 *
 * `loading` is a distinct state rather than an absence of session: on a return
 * visit the stored session is restored asynchronously, and rendering the
 * signed-out screen during that window would flash a sign-in button at players
 * who are already signed in.
 *
 * The session itself is deliberately absent. It stays inside the provider, so
 * no screen can start talking to the server on its own and bypass the session
 * bookkeeping.
 */
export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly profile: PlayerProfile };

/**
 * Members are function properties rather than methods on purpose: components
 * destructure them off the context, so they must be safe to detach from it.
 */
export interface SessionContextValue {
  readonly state: SessionState;
  readonly signInAsGuest: () => Promise<void>;
  readonly signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Attaches an email to the current guest account, keeping its history. */
  readonly upgradeToEmailAccount: (email: string, password: string) => Promise<void>;
  readonly changeDisplayName: (displayName: string) => Promise<void>;
  readonly signOutPlayer: () => Promise<void>;
  /** Loads the playable games. Requires a signed-in player. */
  readonly loadCatalog: () => Promise<GameSummary[]>;
  /**
   * Finds a match with room to spare and joins it.
   *
   * The caller owns the returned connection and must leave it.
   */
  readonly joinMatch: (
    listeners: MatchListeners,
    matchId?: string,
    password?: string,
  ) => Promise<MatchConnection>;
  /** Joins an open lobby, or opens one when there is none. */
  readonly findOpenLobby: () => Promise<string>;
  /** Opens a lobby. An empty password means anyone may walk in. */
  readonly openLobby: (password: string) => Promise<string>;
  /** The lobbies still waiting for an opponent. */
  readonly listOpenLobbies: () => Promise<LobbySummary[]>;
  /** Opens a match and returns a shareable code that leads to it. */
  readonly createInvitation: (matchId?: string) => Promise<Invitation>;
  /** Turns a code back into the match it points at. */
  readonly resolveInvitation: (
    code: string,
  ) => Promise<{ readonly matchId: string; readonly password: string }>;
  /** The signed-in player's record for a game. */
  readonly loadStats: (gameId: string) => Promise<PlayerStats>;
  /** This week's board. */
  readonly loadLeaderboard: () => Promise<LeaderboardEntry[]>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);
