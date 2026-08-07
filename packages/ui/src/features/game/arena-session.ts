import {
  COUNTDOWN_TICKS,
  TICK_RATE,
  aimFromWire,
  createInitialState,
  restingBody,
  type PlayerBody,
  type Seat,
} from '@littlegames/arena-logic';
import type { ArenaRenderer } from '@littlegames/arena-renderer-babylon';
import type { ArenaPlayerState, ArenaSnapshot } from '@littlegames/core';
import { createInputHistory, createSnapshotBuffer, type ArenaConnection, type ArenaMatchListeners } from '@littlegames/net';
import { createArenaInput, type ArenaCommand, type ArenaInput } from './arena-input-sources';
import { DEFAULT_ARENA_SETTINGS, ZOOM_FIELD_OF_VIEW_RATIO, type ArenaSettings } from './arena-settings';
import {
  INTERPOLATION_DELAY_MS,
  NO_SMOOTHING,
  composeArenaView,
  eyeOf,
  predictSelf,
  smoothCamera,
  type ArenaFrame,
  type CameraSmoothing,
  type FramePlayer,
} from './arena-view';

const INPUT_INTERVAL_MS = 1000 / TICK_RATE;

export type ArenaSessionStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'playing'; readonly seat: Seat; readonly matchId: string }
  | { readonly kind: 'reconnecting' }
  | { readonly kind: 'failed'; readonly message: string };

export interface ArenaSession {
  stop: () => void;
  /** Applied to the live input source at once, without a re-render of anything. */
  updateSettings: (next: ArenaSettings) => void;
  /** Takes the pointer back. Must be called from a real user gesture. */
  resume: () => void;
  /** Hands the pointer back to the page, so a menu can be used. */
  release: () => void;
  /** Says this player is ready. The countdown waits for both. */
  setReady: (ready: boolean) => void;
}

/**
 * What the screen around the game needs to know, and nothing else.
 *
 * Reported only when one of these actually changes, never every frame: React
 * draws the panels around the arena and must not be woken sixty times a second
 * to redraw a score that changed once.
 */
export interface ArenaLobbyState {
  readonly phase: 'waiting' | 'countdown' | 'playing' | 'finished';
  readonly youAreReady: boolean;
  readonly opponentPresent: boolean;
  readonly opponentReady: boolean;
  readonly opponentName: string;
}

export interface ArenaSessionListeners {
  onStatus: (status: ArenaSessionStatus) => void;
  /**
   * Pointer lock came or went.
   *
   * Losing it is how Escape arrives: a browser will not let a page keep the
   * pointer through Escape and does not deliver the key either, so the only
   * signal that the player asked to get out is the lock going away.
   */
  onLockChange: (locked: boolean, expected: boolean) => void;
  onOpenSettings: () => void;
  /** The lobby changed. Not called every frame — only when it really changed. */
  onLobbyChange: (lobby: ArenaLobbyState) => void;
}

const PHASES: Record<number, ArenaFrame['phase']> = {
  1: 'waiting',
  2: 'countdown',
  3: 'playing',
  4: 'finished',
};

const SEATS: Record<number, Seat> = { 1: 'north', 2: 'south' };

function bodyOf(player: ArenaPlayerState): PlayerBody {
  const body = player.body;
  if (body === undefined) {
    return restingBody({ x: 0, y: 0, z: 0 });
  }
  return {
    x: body.x,
    y: body.y,
    z: body.z,
    vy: body.vy,
    grounded: body.grounded,
    crouching: body.crouching,
  };
}

function playerOf(player: ArenaPlayerState, seat: Seat): FramePlayer {
  return {
    seat,
    body: bodyOf(player),
    aim: player.aim ?? aimFromWire(0, 0, 1),
    alive: player.alive,
    score: player.score,
    respawnTicks: player.respawnTicks,
    spawnEpoch: player.spawnEpoch,
    ready: player.ready,
  };
}

function lobbyOf(frame: ArenaFrame, opponentName: string): ArenaLobbyState {
  return {
    phase: frame.phase,
    youAreReady: frame.self.ready,
    opponentPresent: frame.opponent !== null,
    opponentReady: frame.opponent?.ready ?? false,
    opponentName,
  };
}

function sameLobby(a: ArenaLobbyState | null, b: ArenaLobbyState): boolean {
  return (
    a !== null &&
    a.phase === b.phase &&
    a.youAreReady === b.youAreReady &&
    a.opponentPresent === b.opponentPresent &&
    a.opponentReady === b.opponentReady &&
    a.opponentName === b.opponentName
  );
}

/** Rebuilds the rules' view of the world from a wire snapshot, for one seat. */
function toFrame(snapshot: ArenaSnapshot, userId: string): ArenaFrame | null {
  const self = snapshot.players.find((player) => player.userId === userId);
  if (self === undefined) {
    return null;
  }
  const seat = SEATS[self.seat];
  if (seat === undefined) {
    return null;
  }
  const other = snapshot.players.find((player) => player.userId !== userId);
  const otherSeat = other === undefined ? undefined : SEATS[other.seat];

  return {
    tick: snapshot.tick,
    phase: PHASES[snapshot.phase] ?? 'waiting',
    phaseTicks: snapshot.phaseTicks,
    seat,
    acknowledgedSeq: self.lastProcessedSeq,
    self: playerOf(self, seat),
    opponent: other === undefined || otherSeat === undefined ? null : playerOf(other, otherSeat),
    winner: SEATS[snapshot.winner] ?? null,
  };
}

/**
 * Runs an Arena match: input, prediction, interpolation and drawing.
 *
 * The same shape as the Pong session, because the platform underneath is the
 * same one: an animation frame loop with React entirely outside it, input sent
 * on the server's cadence rather than the display's, and everything buffered
 * thrown away when the socket is rebuilt or the tab comes back from the
 * background.
 *
 * What is different is what is predicted. Pong predicted one number; this
 * predicts a whole body, by replaying the very commands it sent through the
 * same `stepBody` the server runs. And the camera is the player, so a
 * correction is smoothed into what is drawn rather than snapped into the state.
 */
export async function startArenaSession(
  container: HTMLElement,
  userId: string,
  matchId: string,
  password: string,
  settings: ArenaSettings,
  joinArena: (
    listeners: ArenaMatchListeners,
    matchId: string,
    password?: string,
  ) => Promise<ArenaConnection>,
  listeners: ArenaSessionListeners,
  signal: AbortSignal,
): Promise<ArenaSession> {
  // Loaded only now, so the catalogue and the lobby never carry a 3D engine
  // they have no use for.
  const { createArenaBabylonRenderer } = await import('@littlegames/arena-renderer-babylon');
  const renderer: ArenaRenderer = createArenaBabylonRenderer();

  const buffer = createSnapshotBuffer<ArenaFrame>({ delayMs: INTERPOLATION_DELAY_MS });
  const history = createInputHistory<ArenaCommand>();

  let current = settings;
  let announcedSeat: Seat | null = null;
  let running = true;
  let frame = 0;
  let lastInputAt = 0;
  let lastFrameAt = 0;
  let seq = 0;
  let smoothing: CameraSmoothing = NO_SMOOTHING;
  let lobby: ArenaLobbyState | null = null;
  let drawnEye: { x: number; y: number; z: number } | null = null;
  let predicted: PlayerBody = restingBody({ x: 0, y: 0, z: 0 });

  await renderer.mount(container);
  const surface = renderer.canvas;
  if (surface === null) {
    renderer.destroy();
    throw new Error('The arena could not acquire a drawing surface.');
  }

  const input: ArenaInput = createArenaInput(
    surface,
    {
      onLockChange: listeners.onLockChange,
      onOpenSettings: listeners.onOpenSettings,
    },
    current,
  );

  const resizeToContainer = (): void => {
    renderer.resize(container.clientWidth, container.clientHeight);
  };
  resizeToContainer();
  const resizeObserver = new ResizeObserver(resizeToContainer);
  resizeObserver.observe(container);
  input.start();

  /** Throws away state that describes a moment we are no longer in. */
  const resync = (): void => {
    buffer.reset();
    history.clear();
    smoothing = NO_SMOOTHING;
    drawnEye = null;
  };

  const teardown = (): void => {
    input.stop();
    resizeObserver.disconnect();
    renderer.destroy();
  };

  // Loading the engine takes long enough for the screen to have been left, or
  // for a development double-mount to have discarded this session already.
  if (signal.aborted) {
    teardown();
    throw new Error('The match was left before it started.');
  }

  // One frame before anything has arrived, so the arena is there to look at
  // while the match is being joined instead of a black box.
  const opening = createInitialState();
  renderer.render(
    {
      camera: { position: eyeOf(opening.north.body), forward: { x: 0, y: 0, z: 1 }, fieldOfView: current.look.fieldOfView },
      players: [],
      hud: { ownScore: 0, opponentScore: 0, message: 'Joining…', respawnSeconds: 0, crosshair: false },
    },
    0,
  );

  let connection: ArenaConnection;
  let joinedMatchId = '';
  try {
    connection = await joinArena(
      {
        onSnapshot: (snapshot) => {
          const next = toFrame(snapshot, userId);
          if (next === null) {
            return;
          }
          buffer.push(next, performance.now());
          history.acknowledge(next.acknowledgedSeq);

          const opponentName =
            snapshot.players.find((player) => player.userId !== userId)?.username ?? 'your opponent';
          const nextLobby = lobbyOf(next, opponentName);
          if (!sameLobby(lobby, nextLobby)) {
            lobby = nextLobby;
            listeners.onLobbyChange(nextLobby);
          }
          // The tick the server rewinds from is the newest one this client
          // holds. The interpolation delay is added by the server, from the
          // constant both sides share, rather than being claimed here.
          input.setSeenTick(next.tick);

          if (announcedSeat !== next.seat) {
            clearTimeout(firstSnapshotDeadline);
            announcedSeat = next.seat;
            input.faceSeat(next.seat);
            listeners.onStatus({ kind: 'playing', seat: next.seat, matchId: joinedMatchId });
          }
        },
        onConnectionChange: (link) => {
          if (link === 'reconnecting') {
            listeners.onStatus({ kind: 'reconnecting' });
            return;
          }
          if (link === 'lost') {
            listeners.onStatus({
              kind: 'failed',
              message: 'The connection to the match was lost.',
            });
            return;
          }
          resync();
          if (announcedSeat !== null) {
            listeners.onStatus({ kind: 'playing', seat: announcedSeat, matchId: joinedMatchId });
          }
        },
        onError: () => {
          listeners.onStatus({ kind: 'failed', message: 'The match connection ran into an error.' });
        },
      },
      matchId,
      password,
    );
  } catch (cause) {
    teardown();
    throw cause;
  }

  joinedMatchId = connection.matchId;

  // Joining can succeed while no state ever follows — a seat lost to a race, a
  // socket that went quiet. Without this the screen sits on "joining" for ever.
  const firstSnapshotDeadline = setTimeout(() => {
    if (announcedSeat === null) {
      listeners.onStatus({
        kind: 'failed',
        message: 'The match did not send any state. Try joining again.',
      });
    }
  }, 8000);

  const tick = (now: number): void => {
    if (!running) {
      return;
    }
    frame = requestAnimationFrame(tick);
    const elapsed = lastFrameAt === 0 ? 0 : now - lastFrameAt;
    lastFrameAt = now;

    // Input goes out on the server's cadence, not the display's: a 144 Hz
    // screen must not send two and a half times the commands a 60 Hz one does,
    // and the server consumes exactly one per tick either way.
    if (now - lastInputAt >= INPUT_INTERVAL_MS) {
      lastInputAt = now;
      seq += 1;
      const command = input.sample(seq);
      history.record(command);
      void connection.sendInput(command);
    }

    const latest = buffer.latest();
    const interpolation = buffer.sampleAt(now);
    if (latest === null || interpolation === null) {
      return;
    }

    // This player's own body is replayed forward from the server's copy, so it
    // answers the keys now rather than a round trip from now.
    predicted = predictSelf(latest.self, history.pending());
    const eye = eyeOf(predicted);
    smoothing = smoothCamera(smoothing, drawnEye, eye, latest.self.spawnEpoch, elapsed);

    const drawn = {
      x: eye.x + smoothing.offset.x,
      y: eye.y + smoothing.offset.y,
      z: eye.z + smoothing.offset.z,
    };
    drawnEye = drawn;

    const { from, to, alpha } = interpolation;
    const zoomed = input.isZoomed();
    renderer.render(
      composeArenaView(
        from,
        to,
        alpha,
        drawn,
        input.forward(),
        current.look.fieldOfView * (zoomed ? ZOOM_FIELD_OF_VIEW_RATIO : 1),
      ),
      alpha,
    );
  };

  frame = requestAnimationFrame(tick);

  const onVisibilityChange = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      return;
    }
    // Everything buffered is stamped before the pause and the clock has jumped.
    // Interpolating across that gap would replay the match at speed.
    resync();
    lastInputAt = 0;
    lastFrameAt = 0;
    frame = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    stop() {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      running = false;
      clearTimeout(firstSnapshotDeadline);
      cancelAnimationFrame(frame);
      void connection.leave();
      teardown();
    },
    updateSettings(next) {
      current = next;
      input.setSettings(next);
    },
    resume() {
      input.requestLock();
    },
    release() {
      input.releaseLock();
    },
    setReady(ready) {
      void connection.setReady(ready);
    },
  };
}

export { COUNTDOWN_TICKS, DEFAULT_ARENA_SETTINGS };
