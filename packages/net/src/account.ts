import type { Client, Session } from '@heroiclabs/nakama-js';

/**
 * The account payload Nakama returns.
 *
 * Derived from the client's own signature rather than imported: the SDK does
 * not re-export its generated `Api*` types from the package root, and its
 * `exports` map blocks deep imports. Deriving keeps this in step with the SDK
 * automatically instead of duplicating a shape that would drift.
 */
export type NakamaAccount = Awaited<ReturnType<Client['getAccount']>>;

/**
 * The account fields the shell actually renders.
 *
 * Every field of Nakama's `ApiAccount` is optional on the wire. Narrowing it
 * once, here, keeps that uncertainty out of every component that displays a
 * player.
 */
export interface PlayerProfile {
  readonly userId: string;
  readonly username: string;
  /** Chosen nickname, or `null` while the player has not set one. */
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  /** Set once the account has been upgraded with an email. */
  readonly email: string | null;
  /** Whether this account can still be recovered only from this device. */
  readonly isGuest: boolean;
}

/** Treats blank strings as absent, which is how Nakama returns unset fields. */
function orNull(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

/** Maps a raw Nakama account onto the shape the shell renders. */
export function toPlayerProfile(account: NakamaAccount): PlayerProfile {
  const email = orNull(account.email);
  return {
    userId: account.user?.id ?? '',
    username: account.user?.username ?? '',
    displayName: orNull(account.user?.display_name),
    avatarUrl: orNull(account.user?.avatar_url),
    email,
    isGuest: email === null,
  };
}

/** The name to show for a player, falling back to their generated username. */
export function displayNameOf(profile: PlayerProfile): string {
  return profile.displayName ?? profile.username;
}

/** Loads the signed-in player's account. */
export async function fetchPlayerProfile(client: Client, session: Session): Promise<PlayerProfile> {
  return toPlayerProfile(await client.getAccount(session));
}

/** Updates the signed-in player's nickname. */
export async function updateDisplayName(
  client: Client,
  session: Session,
  displayName: string,
): Promise<void> {
  await client.updateAccount(session, { display_name: displayName });
}
