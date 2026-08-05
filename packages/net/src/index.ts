/**
 * An authenticated player session.
 *
 * Re-exported here so the rest of the app never imports the Nakama SDK
 * directly: this package is the only boundary that knows which backend is
 * behind it.
 */
export type { Session as PlayerSession } from '@heroiclabs/nakama-js';

export type { NakamaConfig } from './config';
export { createNakamaClient } from './client';

export type { KeyValueStore } from './key-value-store';
export {
  createBrowserKeyValueStore,
  createMemoryKeyValueStore,
  createWebKeyValueStore,
} from './key-value-store';

export { resolveDeviceId } from './device-id';

export type { StoredSession } from './session-storage';
export { clearStoredSession, readStoredSession, writeStoredSession } from './session-storage';

export {
  authenticateEmail,
  authenticateGuest,
  linkEmail,
  persistSession,
  restoreSession,
  signOut,
} from './auth';

export type { NakamaAccount, PlayerProfile } from './account';
export {
  displayNameOf,
  fetchPlayerProfile,
  toPlayerProfile,
  updateDisplayName,
} from './account';
