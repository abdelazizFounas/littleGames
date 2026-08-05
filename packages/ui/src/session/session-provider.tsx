import {
  authenticateEmail,
  authenticateGuest,
  createBrowserKeyValueStore,
  createInvitation as createInvitationOnServer,
  createNakamaClient,
  fetchGameCatalog,
  findMatch,
  fetchPlayerProfile,
  joinMatch as joinMatchOnServer,
  linkEmail,
  persistSession,
  resolveInvitation as resolveInvitationOnServer,
  restoreSession,
  signOut,
  updateDisplayName,
  type GameSummary,
  type Invitation,
  type MatchConnection,
  type MatchListeners,
  type PlayerProfile,
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
    async (listeners: MatchListeners, matchId?: string): Promise<MatchConnection> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in before joining a match.');
      }
      // A named match comes from an invitation; without one, find any with room.
      const target = matchId ?? (await findMatch(client, internal.session));
      return joinMatchOnServer(client, config, internal.session, target, listeners);
    },
    [client, config, internal],
  );

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
    async (code: string): Promise<string> => {
      if (internal.status !== 'signed-in') {
        throw new Error('Sign in before opening an invitation.');
      }
      return resolveInvitationOnServer(client, internal.session, code);
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
    }),
    [
      changeDisplayName,
      createInvitation,
      joinMatch,
      loadCatalog,
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
