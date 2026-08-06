import type { Client, Session } from '@heroiclabs/nakama-js';

/**
 * Per-game preferences, kept against the account rather than the machine.
 *
 * They follow the player: sign in on another computer and your sensitivity,
 * your inverted axis and your rebound keys are already there. A guest who later
 * adds an email keeps them, because it is the same account; a guest starting
 * fresh on another machine is a different account and starts from defaults,
 * which is inherent to guest accounts rather than a shortcoming of this.
 *
 * The shape of the settings is not this package's business. It carries an
 * opaque record and a timestamp, and the game that owns the preferences is the
 * one that knows what a valid one looks like.
 */

const SETTINGS_COLLECTION = 'settings';

/**
 * Readable and writable by its owner, and by nobody else.
 *
 * Deliberately different from every other collection this project writes, all
 * of which the server owns. Preferences are nobody's business but the player's,
 * a player can only ever reach their own object, and the worst thing they can
 * do with the write permission is corrupt their own controls — which "reset to
 * defaults" undoes. Nothing here is a claim about a game, so nothing here needs
 * to pass through an RPC to be checked. That is also why `settings` is absent
 * from `catalog.GuardedCollections` on the server, where every other collection
 * a client might try to write is refused.
 */
const PERMISSION_OWNER_READ = 1;
const PERMISSION_OWNER_WRITE = 1;

export interface StoredSettings {
  /** Whatever the game stored. Validated by the game, never here. */
  readonly value: Record<string, unknown>;
  /** When it was last written, in epoch milliseconds. */
  readonly updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the signed-in player's settings for a game, or null when there are none.
 *
 * Null rather than an error for a player who has never opened the panel: having
 * no preferences yet is the normal state, and the caller has defaults for it.
 */
export async function fetchGameSettings(
  client: Client,
  session: Session,
  gameId: string,
): Promise<StoredSettings | null> {
  const userId = session.user_id;
  if (userId === undefined) {
    return null;
  }

  const result = await client.readStorageObjects(session, {
    object_ids: [{ collection: SETTINGS_COLLECTION, key: gameId, user_id: userId }],
  });

  const stored: unknown = result.objects?.[0]?.value;
  if (!isRecord(stored)) {
    return null;
  }

  const { updatedAt, ...value } = stored;
  return {
    value,
    // A blob written by an older build, or hand-edited, may carry no timestamp.
    // Treating that as the beginning of time means any local copy wins over it,
    // which is the safer way round: the local one is at least this machine's.
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

/**
 * Writes the player's settings for a game.
 *
 * Last write wins, which is the right answer for one person editing their own
 * preferences on two machines: there is no conflict to resolve, only a most
 * recent intention.
 */
export async function saveGameSettings(
  client: Client,
  session: Session,
  gameId: string,
  value: Record<string, unknown>,
  updatedAt: number = Date.now(),
): Promise<void> {
  await client.writeStorageObjects(session, [
    {
      collection: SETTINGS_COLLECTION,
      key: gameId,
      value: { ...value, updatedAt },
      permission_read: PERMISSION_OWNER_READ,
      permission_write: PERMISSION_OWNER_WRITE,
    },
  ]);
}
