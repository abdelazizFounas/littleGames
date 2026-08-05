import { Session, type Client } from '@heroiclabs/nakama-js';
import { resolveDeviceId } from './device-id';
import type { KeyValueStore } from './key-value-store';
import { clearStoredSession, readStoredSession, writeStoredSession } from './session-storage';

/**
 * Saves the current token pair.
 *
 * Call this after every operation that touched the server: the client renews
 * expired tokens in place, so the object held in memory can carry newer tokens
 * than the ones on disk. Skipping this is how a player silently gets logged
 * out on their next visit despite a valid session.
 */
export function persistSession(store: KeyValueStore, session: Session): void {
  writeStoredSession(store, { token: session.token, refreshToken: session.refresh_token });
}

/**
 * Signs in as a guest in a single step, creating the account on first use.
 *
 * The account is bound to this browser's device identifier, so the player
 * keeps their progress across visits without ever entering credentials, and
 * can attach an email later without losing anything.
 */
export async function authenticateGuest(client: Client, store: KeyValueStore): Promise<Session> {
  const session = await client.authenticateDevice(resolveDeviceId(store), true);
  persistSession(store, session);
  return session;
}

/**
 * Rebuilds the previous session, or returns `null` when signing in again is
 * unavoidable.
 *
 * A merely expired token is renewed with the refresh token. Once the refresh
 * token itself has expired there is nothing left to salvage, and any server
 * rejection is treated the same way: erase and start clean, never leave the
 * app holding a session the server will keep refusing.
 */
export async function restoreSession(client: Client, store: KeyValueStore): Promise<Session | null> {
  const stored = readStoredSession(store);
  if (stored === null) {
    return null;
  }

  const session = Session.restore(stored.token, stored.refreshToken);
  const nowInSeconds = Date.now() / 1000;

  if (!session.isexpired(nowInSeconds)) {
    return session;
  }

  if (session.isrefreshexpired(nowInSeconds)) {
    clearStoredSession(store);
    return null;
  }

  try {
    const refreshed = await client.sessionRefresh(session);
    persistSession(store, refreshed);
    return refreshed;
  } catch {
    clearStoredSession(store);
    return null;
  }
}

/**
 * Attaches an email and password to the signed-in account.
 *
 * This is an upgrade, not a new account: the player keeps the same user id,
 * profile and history, and gains a way back in from another device.
 */
export async function linkEmail(
  client: Client,
  store: KeyValueStore,
  session: Session,
  email: string,
  password: string,
): Promise<void> {
  await client.linkEmail(session, { email, password });
  persistSession(store, session);
}

/**
 * Signs in with an email account already created on another device.
 */
export async function authenticateEmail(
  client: Client,
  store: KeyValueStore,
  email: string,
  password: string,
): Promise<Session> {
  const session = await client.authenticateEmail(email, password, false);
  persistSession(store, session);
  return session;
}

/**
 * Ends the session server-side and locally.
 *
 * The stored session is erased even when the server call fails, so a network
 * error cannot leave the player apparently signed in on a device they meant to
 * sign out of.
 */
export async function signOut(client: Client, store: KeyValueStore, session: Session): Promise<void> {
  try {
    await client.sessionLogout(session, session.token, session.refresh_token);
  } finally {
    clearStoredSession(store);
  }
}
