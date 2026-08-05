import type { Client, Session } from '@heroiclabs/nakama-js';

const STATS_COLLECTION = 'stats';
const LEADERBOARD_PAGE_SIZE = 20;

/** What a player has done in one game. */
export interface PlayerStats {
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
}

/** One line of the weekly board. */
export interface LeaderboardEntry {
  readonly rank: number;
  readonly username: string;
  readonly wins: number;
  readonly isSelf: boolean;
}

const EMPTY_STATS: PlayerStats = { played: 0, won: 0, lost: 0, pointsFor: 0, pointsAgainst: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function counter(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Reads the signed-in player's record for a game.
 *
 * A player with no history yet is not an error: they get zeros, which is the
 * truth and renders the same way as any other total.
 */
export async function fetchPlayerStats(
  client: Client,
  session: Session,
  gameId: string,
): Promise<PlayerStats> {
  const userId = session.user_id;
  if (userId === undefined) {
    return EMPTY_STATS;
  }

  const result = await client.readStorageObjects(session, {
    object_ids: [{ collection: STATS_COLLECTION, key: gameId, user_id: userId }],
  });

  const value: unknown = result.objects?.[0]?.value;
  if (!isRecord(value)) {
    return EMPTY_STATS;
  }

  return {
    played: counter(value, 'played'),
    won: counter(value, 'won'),
    lost: counter(value, 'lost'),
    pointsFor: counter(value, 'pointsFor'),
    pointsAgainst: counter(value, 'pointsAgainst'),
  };
}

/** Reads this week's board, marking the signed-in player's own line. */
export async function fetchLeaderboard(
  client: Client,
  session: Session,
  gameId: string,
): Promise<LeaderboardEntry[]> {
  const page = await client.listLeaderboardRecords(
    session,
    // One board per game, named after it. A win at one says nothing about who
    // is good at another.
    `${gameId}_wins_weekly`,
    undefined,
    LEADERBOARD_PAGE_SIZE,
  );

  return (page.records ?? []).map((record, index) => ({
    // Nakama numbers ranks from one, but a board with ranks disabled returns
    // none; falling back to position keeps the column filled either way.
    rank: record.rank ?? index + 1,
    username: record.username ?? 'unknown',
    wins: record.score ?? 0,
    isSelf: record.owner_id === session.user_id,
  }));
}
