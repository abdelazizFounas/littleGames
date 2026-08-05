import {
  authenticateEmail,
  authenticateGuest,
  createBrowserKeyValueStore,
  createInvitation as createInvitationOnServer,
  autoLobby,
  checkLobby as checkLobbyOnServer,
  createLobby,
  createNakamaClient,
  fetchGameCatalog,
  fetchLeaderboard,
  fetchPlayerStats,
  fetchPlayerProfile,
  joinMatch as joinMatchOnServer,
  linkEmail,
  listLobbies,
  listMyMatches as listMyMatchesOnServer,
  persistSession,
  resolveInvitation as resolveInvitationOnServer,
  restoreSession,
  signOut,
  updateDisplayName,
  type GameSummary,
  type Invitation,
  type LeaderboardEntry,
  type LobbySummary,
  type ResumableMatch,
  type MatchConnection,
  type MatchListeners,
  type PlayerProfile,
  type PlayerStats,
  type PlayerSession,
} from '@littlegames/net';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readNakamaConfig } from './nakama-config';
import { SessionContext, type SessionContextValue, type SessionState } from './session-context';

/** Provider-private state: unlike the exposed one, it holds the session. */
type InternalState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly session: PlayerSession; readonly profile: PlayerProfile };

export function SessionProvider({ children }: { readonly children: ReactNode }): ReactNode {
  // Both are built once and never rebuilt: a new client would drop in-flight
  // requests, and a new store would hand out a new device id, orphaning the
  // guest account bound to the previous one.
  const [config] = useState(readNakamaConfig);
  const [client] = useState(() => createNakamaClient(config));
  const [store] = useState(() => createBrowserKeyValueStore());
  const [internal, setInternal] = useState<InternalState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const restore = async (): Promise<void> => {
      try {
        const session = await restoreSession(client, store);
        if (cancelled) {
          return;
        }
        if (session === null) {
          setInternal({ status: 'signed-out' });
          return;
        }
        const profile = await fetchPlayerProfile(client, session);
        persistSession(store, session);
        if (!cancelled) {
          setInternal({ status: 'signed-in', session, profile });
        }
      } catch {
        // A server that cannot confirm the stored session leaves the player at
        // the sign-in screen rather than stuck on a spinner forever.
        if (!cancelled) {
          setInternal({ status: 'signed-out' });
        }
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, [client, store]);

  /**
   * Loads the profile for a session and makes it current.
   *
   * Persisting here rather than in each caller is what keeps the stored tokens
   * in step: the client renews them in place, so the session object may hold
   * fresher tokens than storage after any server call.
   */
  const adopt = useCallback(
    async (session: PlayerSession): Promise<void> => {
      const profile = await fetchPlayerProfile(client, session);
      persistSession(store, session);
      setInternal({ status: 'signed-in', session, profile });
    },
    [client, store],
  );

  const signInAsGuest = useCallback(async (): Promise<void> => {
    await adopt(await authenticateGuest(client, store));
  }, [adopt, client, store]);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<void> => {
      await adopt(await authenticateEmail(client, store, email, password));
    },
    [adopt, client, store],
  );

  const upgradeToEmailAccount = useCallback(
    async (email: string, password: string): Promise<void> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in before adding an email address.');
      }
      await linkEmail(client, store, internal.session, email, password);
      await adopt(internal.session);
    },
    [adopt, client, internal, store],
  );

  const changeDisplayName = useCallback(
    async (displayName: string): Promise<void> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in before changing your name.');
      }
      await updateDisplayName(client, internal.session, displayName);
      await adopt(internal.session);
    },
    [adopt, client, internal],
  );

  const loadCatalog = useCallback(async (): Promise<GameSummary[]> => {
    if (internal.status !== 'signed-in') {
      throw new Error('Sign in before browsing the catalogue.');
    }
    return fetchGameCatalog(client, internal.session);
  }, [client, internal]);

  const joinMatch = useCallback(
    async (
      listeners: MatchListeners,
      matchId: string,
      password?: string,
    ): Promise<MatchConnection> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in before joining a match.');
      }
      return joinMatchOnServer(
        client,
        config,
        internal.session,
        matchId,
        listeners,
        password ?? '',
      );
    },
    [client, config, internal],
  );

  const findOpenLobby = useCallback(
    async (game: string): Promise<string> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in before looking for a game.');
      }
      return autoLobby(client, internal.session, game);
    },
    [client, internal],
  );

  const openLobby = useCallback(
    async (game: string, password: string): Promise<string> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in before opening a lobby.');
      }
      return createLobby(client, internal.session, game, password);
    },
    [client, internal],
  );

  const listOpenLobbies = useCallback(
    async (game: string): Promise<LobbySummary[]> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in to see the lobbies.');
      }
      return listLobbies(client, internal.session, game);
    },
    [client, internal],
  );

  const checkLobby = useCallback(
    async (matchId: string, password: string): Promise<void> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in first.');
      }
      await checkLobbyOnServer(client, internal.session, matchId, password);
    },
    [client, internal],
  );

  const listMyMatches = useCallback(async (): Promise<ResumableMatch[]> => {
    if (internal.status !== 'signed-in') {
      throw new Error('Sign in to see your games.');
    }
    return listMyMatchesOnServer(client, internal.session);
  }, [client, internal]);

  const createInvitation = useCallback(
    async (matchId?: string): Promise<Invitation> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in before inviting anyone.');
      }
      return createInvitationOnServer(client, internal.session, matchId);
    },
    [client, internal],
  );

  const resolveInvitation = useCallback(
    async (code: string): Promise<{ readonly matchId: string; readonly password: string }> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in before opening an invitation.');
      }
      return resolveInvitationOnServer(client, internal.session, code);
    },
    [client, internal],
  );

  const loadStats = useCallback(
    async (gameId: string): Promise<PlayerStats> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in to see your record.');
      }
      return fetchPlayerStats(client, internal.session, gameId);
    },
    [client, internal],
  );

  const loadLeaderboard = useCallback(
    async (gameId: string): Promise<LeaderboardEntry[]> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in to see the board.');
      }
      return fetchLeaderboard(client, internal.session, gameId);
    },
    [client, internal],
  );

  const signOutPlayer = useCallback(async (): Promise<void> => {
    if (internal.status !== 'signed-in') {
      return;
    }
    await signOut(client, store, internal.session);
    setInternal({ status: 'signed-out' });
  }, [client, internal, store]);

  const state = useMemo<SessionState>(
    () =>
      internal.status === 'signed-in'
        ? { status: 'signed-in', profile: internal.profile }
        : { status: internal.status },
    [internal],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      signInAsGuest,
      signInWithEmail,
      upgradeToEmailAccount,
      changeDisplayName,
      signOutPlayer,
      loadCatalog,
      joinMatch,
      createInvitation,
      resolveInvitation,
      loadStats,
      loadLeaderboard,
      findOpenLobby,
      openLobby,
      listOpenLobbies,
      listMyMatches,
      checkLobby,
    }),
    [
      changeDisplayName,
      checkLobby,
      createInvitation,
      findOpenLobby,
      joinMatch,
      listMyMatches,
      listOpenLobbies,
      loadCatalog,
      loadLeaderboard,
      loadStats,
      openLobby,
      resolveInvitation,
      signInAsGuest,
      signInWithEmail,
      signOutPlayer,
      state,
      upgradeToEmailAccount,
    ],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}
