// Integration check against a running server. Not part of the build.
//
// Plays one whole game of Battleship between two real clients, on two real
// sockets, against a server holding the only authoritative copy — and then
// looks at what each of them was told. Unit tests cannot cover the thing this
// exists for: that a snapshot built for one player carries nothing of the
// other's fleet beyond the cells that player has already fired at.
//
// Run it with `pnpm --filter @littlegames/net verify:battleship`, with the
// stack up and NAKAMA_SOCKET_SERVER_KEY exported from your .env.
import { Client, type Session, type Socket } from '@heroiclabs/nakama-js';
import {
  Fire,
  OpCode,
  Orientation,
  Phase,
  PlaceFleet,
  Snapshot,
} from '../src/protocol/generated/littlegames/battleship/v1/battleship.ts';

const serverKey = process.env['NAKAMA_SOCKET_SERVER_KEY'];
if (serverKey === undefined) {
  throw new Error('NAKAMA_SOCKET_SERVER_KEY is required');
}

// Defaults to the development stack. Pointed at a deployment by exporting the
// three below, so the same checks can be run against the thing players are
// actually using — which is the only place some faults exist.
const host = process.env['NAKAMA_HOST'] ?? 'localhost';
const port = process.env['NAKAMA_PORT'] ?? '80';
const useSSL = process.env['NAKAMA_USE_SSL'] === 'true';

const client = new Client(serverKey, host, port, useSSL);
console.log(`against ${useSSL ? 'https' : 'http'}://${host}:${port}\n`);

const GAME = 'battleship';
const SHIP_LENGTHS = [5, 4, 3, 3, 2];

/** Two arrangements that share no cell, so a leak would be unmistakable. */
const ALICE_FLEET = SHIP_LENGTHS.map((_, index) => ({
  row: index * 2,
  column: 0,
  orientation: Orientation.ORIENTATION_HORIZONTAL,
}));
const BOB_FLEET = SHIP_LENGTHS.map((_, index) => ({
  row: index * 2 + 1,
  column: 5,
  orientation: Orientation.ORIENTATION_HORIZONTAL,
}));

function cellsOf(fleet: typeof ALICE_FLEET): { row: number; column: number }[] {
  return fleet.flatMap((ship, index) =>
    Array.from({ length: SHIP_LENGTHS[index] ?? 0 }, (_, step) => ({
      row: ship.row,
      column: ship.column + step,
    })),
  );
}

const key = (cell: { row: number; column: number }): string =>
  `${String(cell.row)},${String(cell.column)}`;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let failures = 0;
function check(passed: boolean, description: string): void {
  if (passed) {
    console.log(`  ok    ${description}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${description}`);
}

const authenticate = async (label: string): Promise<Session> => {
  const session = await client.authenticateDevice(crypto.randomUUID(), true);
  console.log(`  ${label}: signed in as ${session.username ?? '?'}`);
  return session;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The match ids in a `lobby.list` answer. */
function lobbyIdsFrom(payload: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isRecord(payload) || !Array.isArray(payload['lobbies'])) {
    return ids;
  }
  const lobbies: unknown[] = payload['lobbies'];
  for (const entry of lobbies) {
    if (isRecord(entry) && typeof entry['matchId'] === 'string') {
      ids.add(entry['matchId']);
    }
  }
  return ids;
}

function matchIdOf(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('matchId' in payload)) {
    throw new Error('the server returned no match id');
  }
  const { matchId } = payload;
  if (typeof matchId !== 'string') {
    throw new Error('the server returned a non-string match id');
  }
  return matchId;
}

/** One player, with everything they have been told and everything they sent. */
interface Player {
  readonly name: string;
  readonly socket: Socket;
  readonly matchId: string;
  readonly snapshots: Snapshot[];
  readonly fired: Set<string>;
}

async function seat(name: string, session: Session, matchId: string): Promise<Player> {
  const socket = client.createSocket(useSSL);
  const snapshots: Snapshot[] = [];

  socket.onmatchdata = (data) => {
    if (data.op_code === OpCode.OP_CODE_SNAPSHOT) {
      snapshots.push(Snapshot.decode(data.data));
    }
    if (data.op_code === OpCode.OP_CODE_REFUSED) {
      console.log(`  ${name} was refused: ${String(data.data.length)} bytes of reason`);
    }
  };

  await socket.connect(session, false);
  await socket.joinMatch(matchId);
  return { name, socket, matchId, snapshots, fired: new Set() };
}

function latest(player: Player): Snapshot {
  const snapshot = player.snapshots.at(-1);
  if (snapshot === undefined) {
    throw new Error(`${player.name} received no snapshot at all`);
  }
  return snapshot;
}

/** Waits until a player's latest snapshot satisfies a condition. */
async function until(
  player: Player,
  description: string,
  ready: (snapshot: Snapshot) => boolean,
): Promise<Snapshot> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const snapshot = player.snapshots.at(-1);
    if (snapshot !== undefined && ready(snapshot)) {
      return snapshot;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop
    await wait(100);
  }
  throw new Error(`timed out waiting for ${player.name}: ${description}`);
}

console.log('=== 1. two players sign in ===');
const aliceSession = await authenticate('alice');
const bobSession = await authenticate('bob');

console.log('\n=== 2. lobbies are per game ===');
const aliceMatch = matchIdOf(
  (await client.rpc(aliceSession, 'lobby.create', { game: GAME, password: '' })).payload,
);
const pongMatch = matchIdOf(
  (await client.rpc(aliceSession, 'lobby.create', { game: 'pong', password: '' })).payload,
);
// The label index is refreshed on a timer, so a lobby is not listable the
// instant it exists.
await wait(1500);

const listed = lobbyIdsFrom((await client.rpc(bobSession, 'lobby.list', { game: GAME })).payload);
check(listed.has(aliceMatch), 'the Battleship lobby is in the Battleship list');
check(!listed.has(pongMatch), 'the Pong lobby is not');

console.log('\n=== 3. both join the same match ===');
const alice = await seat('alice', aliceSession, aliceMatch);
const bob = await seat('bob', bobSession, aliceMatch);

await until(alice, 'placement to open', (snapshot) => snapshot.phase === Phase.PHASE_PLACEMENT);
console.log('  both seated, placement is open');

console.log('\n=== 4. nothing of the other board leaks before a shot ===');
const beforeAnyShot = latest(alice);
check(beforeAnyShot.outgoing.length === 0, 'alice has been told nothing about bob\'s waters');
check(beforeAnyShot.yourFleet.length === 0, 'and nothing about a fleet she has not placed');

console.log('\n=== 5. both place their fleets ===');
await alice.socket.sendMatchState(
  aliceMatch,
  OpCode.OP_CODE_PLACE_FLEET,
  PlaceFleet.encode({ ships: ALICE_FLEET }).finish(),
);
await bob.socket.sendMatchState(
  aliceMatch,
  OpCode.OP_CODE_PLACE_FLEET,
  PlaceFleet.encode({ ships: BOB_FLEET }).finish(),
);

const playing = await until(alice, 'play to begin', (snapshot) => snapshot.phase === Phase.PHASE_PLAYING);
check(playing.yourFleet.length === SHIP_LENGTHS.length, 'alice is sent her own fleet in full');
check(latest(bob).yourFleet.length === SHIP_LENGTHS.length, 'and bob is sent his');

console.log('\n=== 6. one player fires until the other is sunk ===');
const opener = playing.yourTurn ? alice : bob;
const target = opener === alice ? bob : alice;
const targetFleet = opener === alice ? BOB_FLEET : ALICE_FLEET;
console.log(`  ${opener.name} opens, and knows exactly where ${target.name} is`);

// Every one of these is a hit, so the turn never leaves the opener. Seventeen
// shots is the shortest game there is.
for (const cell of cellsOf(targetFleet)) {
  opener.fired.add(key(cell));
  // oxlint-disable-next-line eslint/no-await-in-loop
  await opener.socket.sendMatchState(
    opener.matchId,
    OpCode.OP_CODE_FIRE,
    Fire.encode({ row: cell.row, column: cell.column }).finish(),
  );
  // oxlint-disable-next-line eslint/no-await-in-loop
  await wait(120);
}

const won = await until(opener, 'the game to finish', (snapshot) => snapshot.finished);
const lost = await until(target, 'the game to finish', (snapshot) => snapshot.finished);
check(won.youWon, `${opener.name} is told they won`);
check(!lost.youWon, `${target.name} is told they did not`);
check(won.opponentShipsSunk === SHIP_LENGTHS.length, 'every ship of the loser is on the bottom');
check(lost.yourShipsSunk === SHIP_LENGTHS.length, 'and the loser is told the same about their own');

console.log('\n=== 7. the loser was never told where the winner was ===');
const loserFleet = opener === alice ? ALICE_FLEET : BOB_FLEET;
const unfired = cellsOf(loserFleet).filter((cell) => !target.fired.has(key(cell)));
check(unfired.length > 0, 'the loser never fired a shot, so every winner cell is untouched');

const leaked = lost.outgoing.filter((shot) => !target.fired.has(key(shot)));
check(leaked.length === 0, 'no cell appears in their snapshot that they did not fire at');

const everySnapshotClean = target.snapshots.every((snapshot) =>
  snapshot.outgoing.every((shot) => target.fired.has(key(shot))),
);
check(everySnapshotClean, 'and that holds for every snapshot they ever received, not just the last');

const winnerClean = opener.snapshots.every((snapshot) =>
  snapshot.outgoing.every((shot) => opener.fired.has(key(shot))),
);
check(winnerClean, 'the winner was told about their own shots and no others');

console.log('\n=== 8. the win reached the weekly board for this game ===');
await wait(600);
const board = await client.listLeaderboardRecords(aliceSession, `${GAME}_wins_weekly`, undefined, 20);
const winnerId = opener === alice ? aliceSession.user_id : bobSession.user_id;
check(
  (board.records ?? []).some((record) => record.owner_id === winnerId),
  'the winner is on the Battleship board',
);

alice.socket.disconnect(false);
bob.socket.disconnect(false);

console.log(failures === 0 ? '\ndone, everything held' : `\ndone, ${String(failures)} check(s) failed`);
if (failures > 0) {
  process.exitCode = 1;
}
