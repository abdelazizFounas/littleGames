import type { Client, Session } from '@heroiclabs/nakama-js';

const CATALOG_COLLECTION = 'catalog';

/**
 * Nakama caps a storage listing at 100 objects and — less obviously — defaults
 * to 1 when no limit is given, so the limit is always passed explicitly.
 */
const CATALOG_PAGE_SIZE = 100;

/**
 * Owner Nakama assigns to objects the server writes.
 *
 * Scoping the listing to it is not cosmetic. Storage objects are namespaced by
 * owner, and a listing with no owner returns every object the caller may read —
 * including ones other players wrote into the same collection and marked
 * public. Without this, one player could put an entry in everybody else's game
 * list. The server also refuses client writes to this collection outright; this
 * is the second of the two locks.
 */
const SYSTEM_OWNER_ID = '00000000-0000-0000-0000-000000000000';

/** One playable game, as the catalogue describes it. */
export interface GameSummary {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
}

/** Narrows to something field lookups are safe on, without asserting a type. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function playerCountField(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Validates one stored catalogue entry, returning `null` if it is unusable.
 *
 * The catalogue is editable from the Nakama console without a redeployment,
 * which means its contents are exactly as trustworthy as the last person who
 * edited them. Validating here keeps a typo from reaching the screens.
 */
export function toGameSummary(value: unknown): GameSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = value;
  const id = stringField(record, 'id');
  const name = stringField(record, 'name');
  const tagline = stringField(record, 'tagline');
  const description = stringField(record, 'description');
  const minPlayers = playerCountField(record, 'minPlayers');
  const maxPlayers = playerCountField(record, 'maxPlayers');

  if (
    id === null ||
    name === null ||
    tagline === null ||
    description === null ||
    minPlayers === null ||
    maxPlayers === null ||
    maxPlayers < minPlayers
  ) {
    return null;
  }

  return { id, name, tagline, description, minPlayers, maxPlayers };
}

/**
 * Loads the playable games.
 *
 * Entries that fail validation are skipped rather than thrown on: one game
 * broken by a bad console edit should cost that one game, not the whole
 * catalogue.
 */
export async function fetchGameCatalog(client: Client, session: Session): Promise<GameSummary[]> {
  const page = await client.listStorageObjects(
    session,
    CATALOG_COLLECTION,
    SYSTEM_OWNER_ID,
    CATALOG_PAGE_SIZE,
  );

  const games = page.objects.flatMap((object) => {
    const game = toGameSummary(object.value);
    return game === null ? [] : [game];
  });

  // Storage returns objects in key order, which is an implementation detail of
  // the ids. Sorting by name keeps the list stable and readable.
  return games.toSorted((left, right) => left.name.localeCompare(right.name));
}
