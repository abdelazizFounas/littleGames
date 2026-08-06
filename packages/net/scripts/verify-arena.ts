// Integration check against a running server. Not part of the build.
//
// Plays a scripted Arena round between two real clients, on two real sockets,
// against a server holding the only authoritative copy. Unit tests cannot cover
// what this exists for: that the server is the one deciding where a player is
// and whether a shot landed, and that a client which lies about its intent gets
// nothing for it.
//
// Run it with `pnpm --filter @littlegames/net verify:arena`, with the stack up
// and NAKAMA_SOCKET_SERVER_KEY exported from your .env.
import { Client, type Session, type Socket } from '@heroiclabs/nakama-js';
import {
  OpCode,
  Phase,
  PlayerInput,
  Seat,
  Snapshot,
  type PlayerState,
} from '../src/protocol/generated/littlegames/arena/v1/arena.ts';

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

const GAME = 'arena';

// The wire contract, restated here rather than imported: this package depends
// on `core` alone, and a check that borrowed the game's own constants would
// agree with the server by construction instead of by observation.
const TICK_RATE = 60;
const MOVE_SCALE = 1024;
const AIM_SCALE = 8192;
const MOVE_SPEED = 5.5;
const STAND_EYE = 1.6;
const STAND_HEIGHT = 1.8;
const WINNING_SCORE = 7;

/** How often a client samples and sends its intent. Once per server tick. */
const SEND_INTERVAL_MS = 1000 / TICK_RATE;

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

/** What one client is holding down, as the integers that go on the wire. */
interface Intent {
  moveX: number;
  moveZ: number;
  aimX: number;
  aimY: number;
  aimZ: number;
  jump: boolean;
  crouch: boolean;
  shotsFired: number;
}

/** One player, with everything they have been told and everything they sent. */
interface Player {
  readonly name: string;
  readonly userId: string;
  readonly socket: Socket;
  readonly matchId: string;
  readonly snapshots: Snapshot[];
  readonly intent: Intent;
  seq: number;
  timer: ReturnType<typeof setInterval> | undefined;
}

async function seat(name: string, session: Session, matchId: string): Promise<Player> {
  const socket = client.createSocket(useSSL);
  const snapshots: Snapshot[] = [];

  socket.onmatchdata = (data) => {
    if (data.op_code === OpCode.OP_CODE_SNAPSHOT) {
      snapshots.push(Snapshot.decode(data.data));
    }
  };

  await socket.connect(session, false);
  await socket.joinMatch(matchId);

  return {
    name,
    userId: session.user_id ?? '',
    socket,
    matchId,
    snapshots,
    // Aim starts down the arena, which is where a spawning player looks.
    intent: { moveX: 0, moveZ: 0, aimX: 0, aimY: 0, aimZ: AIM_SCALE, jump: false, crouch: false, shotsFired: 0 },
    seq: 0,
    timer: undefined,
  };
}

function latest(player: Player): Snapshot {
  const snapshot = player.snapshots.at(-1);
  if (snapshot === undefined) {
    throw new Error(`${player.name} received no snapshot at all`);
  }
  return snapshot;
}

function stateOf(player: Player, snapshot: Snapshot): PlayerState {
  const found = snapshot.players.find((candidate) => candidate.userId === player.userId);
  if (found === undefined) {
    throw new Error(`${player.name} is not in the snapshot`);
  }
  return found;
}

/**
 * Starts sending one command per server tick, and keeps sending.
 *
 * A real client samples its own controls at the tick rate; so does this. It is
 * also what the server's input queue is written for — exactly one command
 * consumed per tick, the last one repeated when the queue starves.
 */
function startSending(player: Player): void {
  player.timer = setInterval(() => {
    player.seq += 1;
    const seen = player.snapshots.at(-1)?.tick ?? 0;
    void player.socket
      .sendMatchState(
        player.matchId,
        OpCode.OP_CODE_PLAYER_INPUT,
        PlayerInput.encode({
          seq: player.seq,
          moveX: player.intent.moveX,
          moveZ: player.intent.moveZ,
          aimX: player.intent.aimX,
          aimY: player.intent.aimY,
          aimZ: player.intent.aimZ,
          jump: player.intent.jump,
          crouch: player.intent.crouch,
          zoomed: false,
          seenTick: seen,
          shotsFired: player.intent.shotsFired,
        }).finish(),
      )
      .catch(() => {
        // A send that fails mid-run is reported by the checks that follow it
        // finding a player who never moved, which is the more useful failure.
      });
  }, SEND_INTERVAL_MS);
}

function stopSending(player: Player): void {
  if (player.timer !== undefined) {
    clearInterval(player.timer);
    player.timer = undefined;
  }
}

/** Waits until a player's latest snapshot satisfies a condition. */
async function until(
  player: Player,
  description: string,
  ready: (snapshot: Snapshot) => boolean,
  attempts = 120,
): Promise<Snapshot> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
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

console.log('\n=== 2. the arena has its own lobbies ===');
const arenaMatch = matchIdOf(
  (await client.rpc(aliceSession, 'lobby.create', { game: GAME, password: '' })).payload,
);
console.log(`  lobby ${arenaMatch}`);

console.log('\n=== 3. both join, and the countdown opens ===');
const alice = await seat('alice', aliceSession, arenaMatch);
const bob = await seat('bob', bobSession, arenaMatch);

const opened = await until(alice, 'the countdown to open', (snapshot) =>
  snapshot.phase === Phase.PHASE_COUNTDOWN || snapshot.phase === Phase.PHASE_PLAYING,
);
check(opened.players.length === 2, 'both players are in the snapshot');
check(
  stateOf(alice, opened).seat !== stateOf(bob, opened).seat,
  'they hold opposite halves of the arena',
);

startSending(alice);
startSending(bob);

console.log('\n=== 4. the snapshot rate is the one the physics was written for ===');
const before = alice.snapshots.length;
await wait(2000);
const perSecond = (alice.snapshots.length - before) / 2;
console.log(`  ~${perSecond.toFixed(1)} snapshots/second`);
check(perSecond > TICK_RATE * 0.8, `the server is ticking at about ${String(TICK_RATE)} Hz`);

const playing = await until(alice, 'the round to open', (snapshot) => snapshot.phase === Phase.PHASE_PLAYING);
console.log(`  round open at tick ${String(playing.tick)}`);

console.log('\n=== 5. a client cannot outrun the speed cap by claiming a longer stick ===');
// Twice the length of a full deflection, which is the widest the protocol will
// carry at all. A client sending it is claiming to push its stick twice as far
// as a stick goes.
alice.intent.moveX = MOVE_SCALE * 2;
// And an aim far outside the range, to be clamped and then normalised.
alice.intent.aimX = AIM_SCALE * 1000;
alice.intent.aimZ = 0;

await wait(300);
const from = latest(alice);
const fromBody = stateOf(alice, from).body;
await wait(600);
const to = latest(alice);
const toBody = stateOf(alice, to).body;

alice.intent.moveX = 0;

const ticks = to.tick - from.tick;
const travelled = Math.abs((toBody?.x ?? 0) - (fromBody?.x ?? 0));
const seconds = ticks / TICK_RATE;
const speed = travelled / seconds;
console.log(`  moved ${travelled.toFixed(3)} m over ${String(ticks)} ticks -> ${speed.toFixed(3)} m/s`);

check(travelled > 0.5, 'the oversized command was honoured rather than dropped');
check(speed <= MOVE_SPEED + 0.001, `and shortened to the cap of ${String(MOVE_SPEED)} m/s`);
check(speed > MOVE_SPEED * 0.98, 'exactly to the cap, not to some fraction of it');

const aim = stateOf(alice, to).aim;
const aimLength = Math.hypot(aim?.x ?? 0, aim?.y ?? 0, aim?.z ?? 0);
console.log(`  aim came back as (${(aim?.x ?? 0).toFixed(3)}, ${(aim?.y ?? 0).toFixed(3)}, ${(aim?.z ?? 0).toFixed(3)})`);
check(Math.abs(aimLength - 1) < 1e-9, 'the out-of-range aim came back unit length');

console.log('\n=== 6. alice walks back to the middle of her half ===');
// Under her own control this time, which is also a check that a client can
// steer at all rather than only be capped.
for (let attempt = 0; attempt < 100; attempt += 1) {
  const body = stateOf(alice, latest(alice)).body;
  const x = body?.x ?? 0;
  if (Math.abs(x) < 0.1) {
    break;
  }
  // Deflection proportional to what is left, and gentle: a command spends a
  // few ticks in the server's queue before it is executed, so a controller
  // steering at full speed off a position that old sails past the middle and
  // back. It also exercises a partial deflection, which is the case
  // `clampToUnit` is written to leave alone.
  const deflection = Math.max(-1, Math.min(1, -x / 2));
  alice.intent.moveX = Math.round(deflection * MOVE_SCALE);
  // oxlint-disable-next-line eslint/no-await-in-loop
  await wait(30);
}
alice.intent.moveX = 0;
await wait(100);
console.log(`  back at x = ${(stateOf(alice, latest(alice)).body?.x ?? 0).toFixed(3)}`);

console.log('\n=== 7. bob shoots the round out ===');
// Bob aims at the middle of alice's body from his own eyes, every tick, and
// claims a shot by moving his counter on. The server decides whether it landed.
function aimAtAlice(): void {
  const snapshot = latest(bob);
  const shooter = stateOf(bob, snapshot).body;
  const target = stateOf(alice, snapshot).body;
  if (shooter === undefined || target === undefined) {
    return;
  }
  const x = target.x - shooter.x;
  const y = target.y + STAND_HEIGHT / 2 - (shooter.y + STAND_EYE);
  const z = target.z - shooter.z;
  const length = Math.hypot(x, y, z) || 1;
  bob.intent.aimX = Math.round((x / length) * AIM_SCALE);
  bob.intent.aimY = Math.round((y / length) * AIM_SCALE);
  bob.intent.aimZ = Math.round((z / length) * AIM_SCALE);
}

const startedAt = Date.now();
let lastScore = 0;
while (Date.now() - startedAt < 40_000) {
  const snapshot = latest(bob);
  if (snapshot.phase === Phase.PHASE_FINISHED) {
    break;
  }

  aimAtAlice();

  const me = stateOf(bob, snapshot);
  const victim = stateOf(alice, snapshot);
  if (me.alive && victim.alive && me.cooldownTicks === 0) {
    // A counter, not a flag: a duplicate delivery re-sends a number the server
    // has already reached and fires nothing.
    bob.intent.shotsFired += 1;
  }
  if (me.score !== lastScore) {
    lastScore = me.score;
    console.log(`  ${String(me.score)}-${String(victim.score)}`);
  }

  // oxlint-disable-next-line eslint/no-await-in-loop
  await wait(50);
}

const finished = await until(bob, 'the match to finish', (snapshot) => snapshot.phase === Phase.PHASE_FINISHED, 60);
const winner = stateOf(bob, finished);
const loser = stateOf(alice, finished);

check(winner.score >= WINNING_SCORE, `bob reached ${String(WINNING_SCORE)} points`);
check(finished.winner === winner.seat, 'and is named the winner');
check(loser.score === 0, 'alice, who never fired, scored nothing');
check(!loser.alive, 'the last shot left her dead, and the match ended on it');
// Every death but the last one was followed by a respawn: the seventh ended the
// match, and a finished match does not put anybody back on their feet.
check(
  loser.spawnEpoch === WINNING_SCORE - 1,
  `and she was respawned ${String(WINNING_SCORE - 1)} times, once after every death but that one`,
);

console.log('\n=== 8. the shots the server resolved travelled with the snapshots ===');
const shotIds = new Set<number>();
let hits = 0;
for (const snapshot of bob.snapshots) {
  for (const shot of snapshot.shots) {
    if (!shotIds.has(shot.id)) {
      shotIds.add(shot.id);
      if (shot.hitPlayer) {
        hits += 1;
      }
    }
  }
}
console.log(`  ${String(shotIds.size)} distinct shots seen, ${String(hits)} of them hits`);
check(shotIds.size >= WINNING_SCORE, 'every shot fired was reported at least once');
check(hits >= WINNING_SCORE, 'and the ones that scored are marked as hits');
const named = bob.snapshots.every((snapshot) =>
  snapshot.shots.every((shot) => shot.shooter !== Seat.SEAT_UNSPECIFIED),
);
check(named, 'each shot names the seat that fired it');

console.log('\n=== 9. the win reached the weekly board for this game ===');
await wait(600);
const board = await client.listLeaderboardRecords(aliceSession, `${GAME}_wins_weekly`, undefined, 20);
check(
  (board.records ?? []).some((record) => record.owner_id === bobSession.user_id),
  'the winner is on the Arena board',
);

stopSending(alice);
stopSending(bob);
alice.socket.disconnect(false);
bob.socket.disconnect(false);

console.log(failures === 0 ? '\ndone, everything held' : `\ndone, ${String(failures)} check(s) failed`);
if (failures > 0) {
  process.exitCode = 1;
}
