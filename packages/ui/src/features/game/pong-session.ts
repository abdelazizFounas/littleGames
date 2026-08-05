import type { GameRenderer } from '@littlegames/core';
import type { MatchConnection, MatchListeners } from '@littlegames/net';
import { createInputHistory, createSnapshotBuffer, reconcile } from '@littlegames/net';
import {
  FIELD_HEIGHT,
  TICK_RATE,
  createInitialState,
  movePaddle,
  type PongState,
  type Side,
} from '@littlegames/pong-logic';
import { combineInputs, createKeyboardInput, createTouchInput, type PongCommand } from './input-sources';

/** How far behind live the opponent and the ball are drawn. */
const INTERPOLATION_DELAY_MS = 100;
const INPUT_INTERVAL_MS = 1000 / TICK_RATE;

export type SessionStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'playing'; readonly side: Side; readonly matchId: string }
  | { readonly kind: 'failed'; readonly message: string };

export interface PongSession {
  stop: () => void;
}

/** Snapshot as this client keeps it: the rules' state plus who we are in it. */
interface AuthoritativeFrame {
  readonly state: PongState;
  readonly side: Side;
  readonly acknowledgedSeq: number;
}

type ProtocolSnapshot = Parameters<MatchListeners['onSnapshot']>[0];

const PHASES: Record<number, PongState['phase']> = {
  1: 'waiting',
  2: 'countdown',
  3: 'playing',
  4: 'pointScored',
  5: 'finished',
};

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/** Rebuilds the rules' state from a wire snapshot, for this player's seat. */
function toFrame(snapshot: ProtocolSnapshot, userId: string): AuthoritativeFrame | null {
  const game = snapshot.game;
  const self = snapshot.players.find((player) => player.userId === userId);
  if (game === undefined || game.ball === undefined || self === undefined) {
    return null;
  }

  const base = createInitialState();
  return {
    side: self.side === 2 ? 'right' : 'left',
    acknowledgedSeq: self.lastProcessedSeq,
    state: {
      ...base,
      phase: PHASES[game.phase] ?? 'waiting',
      phaseTicks: game.phaseTicks,
      left: { y: game.leftPaddleY },
      right: { y: game.rightPaddleY },
      ball: {
        x: game.ball.x,
        y: game.ball.y,
        vx: game.ball.vx,
        vy: game.ball.vy,
        speed: game.ball.speed,
      },
      score: { left: game.scoreLeft, right: game.scoreRight },
      winner: game.winner === 1 ? 'left' : game.winner === 2 ? 'right' : null,
    },
  };
}

/**
 * Runs a Pong match: input, prediction, interpolation and drawing.
 *
 * Deliberately plain TypeScript with its own animation frame loop. React never
 * enters it — a component re-rendering sixty times a second to move a ball
 * would cost far more than drawing it does — so the loop only reports back on
 * events worth a re-render, such as connecting or failing.
 */
export async function startPongSession(
  container: HTMLElement,
  userId: string,
  matchId: string | undefined,
  joinMatch: (listeners: MatchListeners, matchId?: string) => Promise<MatchConnection>,
  onStatus: (status: SessionStatus) => void,
): Promise<PongSession> {
  // Loaded only now, so the catalogue and the lobby never carry a rendering
  // engine they have no use for.
  const { createPongPixiRenderer } = await import('@littlegames/pong-renderer-pixi');
  const renderer: GameRenderer<PongState> = createPongPixiRenderer();

  const buffer = createSnapshotBuffer<AuthoritativeFrame>({ delayMs: INTERPOLATION_DELAY_MS });
  const history = createInputHistory<PongCommand>();

  let announcedSide: Side | null = null;
  let predictedY = FIELD_HEIGHT / 2;
  let running = true;
  let frame = 0;
  let lastInputAt = 0;
  let seq = 0;

  const input = combineInputs([
    createKeyboardInput(window),
    createTouchInput(container, () => predictedY / FIELD_HEIGHT),
  ]);

  const resizeToContainer = (): void => {
    renderer.resize(container.clientWidth, container.clientHeight);
  };

  await renderer.mount(container);
  resizeToContainer();
  // One frame before anything has arrived from the server. Without it the
  // canvas stays blank until the first snapshot, which reads as the game
  // having failed rather than as it being about to start.
  renderer.render(createInitialState(), 0);
  // Watching the element rather than the window catches every reason it can
  // change size — entering fullscreen, rotating a phone, the layout reflowing —
  // with one listener instead of one per cause.
  const resizeObserver = new ResizeObserver(resizeToContainer);
  resizeObserver.observe(container);
  input.start();

  let connection: MatchConnection;
  let joinedMatchId = '';
  try {
    connection = await joinMatch({
      onSnapshot: (snapshot) => {
        const next = toFrame(snapshot, userId);
        if (next === null) {
          return;
        }
        buffer.push(next, performance.now());
        history.acknowledge(next.acknowledgedSeq);

        // Which seat we took is only known once the server says so. Reporting
        // at join time instead meant announcing a default, which was wrong for
        // whichever player took the other side.
        if (announcedSide !== next.side) {
          clearTimeout(firstSnapshotDeadline);
          announcedSide = next.side;
          // The match is reported alongside the side so an invitation can be
          // minted for the match actually being played, rather than a new one.
          onStatus({ kind: 'playing', side: next.side, matchId: joinedMatchId });
        }
      },
      onDisconnect: () => {
        onStatus({ kind: 'failed', message: 'The connection to the match was lost.' });
      },
      onError: () => {
        onStatus({ kind: 'failed', message: 'The match connection ran into an error.' });
      },
    }, matchId);
  } catch (cause) {
    input.stop();
    resizeObserver.disconnect();
    renderer.destroy();
    throw cause;
  }

  joinedMatchId = connection.matchId;

  // Joining can succeed while no state ever follows — a seat lost to a race,
  // a socket that went quiet. Without this the screen sits on "joining" for
  // ever, which tells the player nothing and offers them nothing.
  const firstSnapshotDeadline = setTimeout(() => {
    if (announcedSide === null) {
      onStatus({
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

    // Input goes out on the server's cadence, not the display's. A 144 Hz
    // screen must not send five times the inputs a 30 Hz one does.
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

    // Our own paddle is drawn from our own inputs, with no delay at all.
    // Waiting for the server would make it answer a key a whole round trip
    // late, which is the one lag a player feels immediately.
    predictedY = reconcile(
      latest.state[latest.side].y,
      history.pending(),
      (y, command) => movePaddle({ y }, command).y,
    );

    // The ball and the opponent are drawn slightly in the past, between the two
    // snapshots that bracket that moment, which is what turns thirty updates a
    // second into continuous motion.
    const { from, to, alpha } = interpolation;
    const interpolatedLeft = lerp(from.state.left.y, to.state.left.y, alpha);
    const interpolatedRight = lerp(from.state.right.y, to.state.right.y, alpha);

    const drawn: PongState = {
      ...latest.state,
      left: { y: latest.side === 'left' ? predictedY : interpolatedLeft },
      right: { y: latest.side === 'right' ? predictedY : interpolatedRight },
      ball: {
        ...latest.state.ball,
        x: lerp(from.state.ball.x, to.state.ball.x, alpha),
        y: lerp(from.state.ball.y, to.state.ball.y, alpha),
      },
    };

    renderer.render(drawn, alpha);
  };

  frame = requestAnimationFrame(tick);

  return {
    stop() {
      running = false;
      clearTimeout(firstSnapshotDeadline);
      cancelAnimationFrame(frame);
      input.stop();
      resizeObserver.disconnect();
      void connection.leave();
      renderer.destroy();
    },
  };
}
