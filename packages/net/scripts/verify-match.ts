// Integration check against a running server. Not part of the build.
//
// Drives two real clients end to end: both ask for a match, join it, and one
// sends input while the other watches the authoritative echo come back. Unit
// tests cannot cover this, because what is being checked is that two separate
// sockets agree with a server holding the only authoritative copy.
//
// Run it with `pnpm --filter @littlegames/net verify:match`, with the stack up
// and NAKAMA_SOCKET_SERVER_KEY exported from your .env.
import { Client } from '@heroiclabs/nakama-js';
import {
  OpCode,
  PlayerInput,
  Snapshot,
} from '../src/protocol/generated/littlegames/match/v1/match.ts';

const serverKey = process.env['NAKAMA_SOCKET_SERVER_KEY'];
if (serverKey === undefined) {
  throw new Error('NAKAMA_SOCKET_SERVER_KEY is required');
}

const client = new Client(serverKey, 'localhost', '80', false);

const authenticate = async (label: string) => {
  const session = await client.authenticateDevice(crypto.randomUUID(), true);
  console.log(`  ${label}: signed in as ${session.username ?? '?'}`);
  return session;
};

// Nakama rejects with a plain object carrying `message`, not with an Error.
const reasonOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    if (typeof message === 'string') {
      return message;
    }
  }
  return JSON.stringify(error);
};

const rpcMatchId = async (session: Awaited<ReturnType<typeof authenticate>>) => {
  // `lobby.auto` takes the game from the request, which is what replaced the
  // Pong-only `match.find` when the lobby layer stopped assuming one game.
  const response = await client.rpc(session, 'lobby.auto', { game: 'pong' });
  const payload: unknown = response.payload;
  if (typeof payload !== 'object' || payload === null || !('matchId' in payload)) {
    throw new Error('the server returned no match id');
  }
  const { matchId } = payload;
  if (typeof matchId !== 'string') {
    throw new Error('the server returned a non-string match id');
  }
  return matchId;
};

console.log('=== 1. two independent players sign in ===');
const alice = await authenticate('alice');
const bob = await authenticate('bob');

console.log('\n=== 2. both ask the server for a match ===');
const aliceMatch = await rpcMatchId(alice);
// A lobby is not listable the instant it exists: the label index is refreshed
// on a timer, and two humans never click inside one refresh anyway. Waiting a
// window reproduces real timing instead of a race no player can hit.
await new Promise((resolve) => setTimeout(resolve, 1500));
const bobMatch = await rpcMatchId(bob);
console.log(`  alice -> ${aliceMatch}`);
console.log(`  bob   -> ${bobMatch}`);
console.log(`  same match: ${String(aliceMatch === bobMatch)}`);

console.log('\n=== 3. both join over a socket ===');
const aliceSocket = client.createSocket(false);
const bobSocket = client.createSocket(false);

const bobSnapshots: Snapshot[] = [];
bobSocket.onmatchdata = (data) => {
  if (data.op_code === OpCode.OP_CODE_SNAPSHOT) {
    bobSnapshots.push(Snapshot.decode(data.data));
  }
};

await aliceSocket.connect(alice, false);
await bobSocket.connect(bob, false);
await aliceSocket.joinMatch(aliceMatch);
await bobSocket.joinMatch(bobMatch);
console.log('  both joined');

console.log('\n=== 4. alice sends input, bob watches the server echo ===');
await new Promise((resolve) => setTimeout(resolve, 300));

await aliceSocket.sendMatchState(
  aliceMatch,
  OpCode.OP_CODE_PLAYER_INPUT,
  PlayerInput.encode({ seq: 7, up: true, down: false }).finish(),
);

await new Promise((resolve) => setTimeout(resolve, 500));

const latest = bobSnapshots.at(-1);
if (latest === undefined) {
  throw new Error('bob received no snapshot at all');
}
console.log(`  bob received ${String(bobSnapshots.length)} snapshots total`);
console.log(`  players in the last snapshot: ${String(latest.players.length)}`);
for (const player of latest.players) {
  console.log(
    `    ${player.username}  seq=${String(player.lastProcessedSeq)}  up=${String(player.up)}  down=${String(player.down)}`,
  );
}

console.log('\n=== 4b. the simulation is running server-side ===');
const game = latest.game;
if (game === undefined) {
  throw new Error('the snapshot carries no game state');
}
console.log(`  phase=${String(game.phase)} phaseTicks=${String(game.phaseTicks)} score=${String(game.scoreLeft)}-${String(game.scoreRight)}`);
console.log(`  ball x=${game.ball?.x.toFixed(1) ?? '?'} y=${game.ball?.y.toFixed(1) ?? '?'} speed=${game.ball?.speed.toFixed(1) ?? '?'}`);
console.log(`  sides: ${latest.players.map((p) => `${p.username}=${String(p.side)}`).join(', ')}`);

await new Promise((resolve) => setTimeout(resolve, 4000));
const later = bobSnapshots.at(-1);
const laterGame = later?.game;
console.log(`  four seconds on: phase=${String(laterGame?.phase)} ball x=${laterGame?.ball?.x.toFixed(1) ?? '?'} y=${laterGame?.ball?.y.toFixed(1) ?? '?'}`);
if (laterGame?.ball?.x === game.ball?.x && laterGame?.ball?.y === game.ball?.y) {
  console.log('  PROBLEM: the ball never moved');
} else {
  console.log('  the ball is moving under the server simulation');
}

console.log('\n=== 5. measured tick rate ===');
const start = bobSnapshots.length;
await new Promise((resolve) => setTimeout(resolve, 2000));
const perSecond = (bobSnapshots.length - start) / 2;
console.log(`  ~${perSecond.toFixed(1)} snapshots/second (server is configured for 30)`);

console.log('\n=== 6. a third player must be turned away (capacity 2) ===');
const carol = await authenticate('carol');
const carolSocket = client.createSocket(false);
await carolSocket.connect(carol, false);
try {
  await carolSocket.joinMatch(aliceMatch);
  console.log('  PROBLEM: carol got into a full match');
} catch (error) {
  console.log(`  refused, as expected: ${reasonOf(error)}`);
}

aliceSocket.disconnect(false);
bobSocket.disconnect(false);
carolSocket.disconnect(false);
console.log('\ndone');
