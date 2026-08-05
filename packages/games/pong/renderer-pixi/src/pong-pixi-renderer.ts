import type { GameRenderer } from '@littlegames/core';
import {
  BALL_RADIUS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  LEFT_PADDLE_X,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  RIGHT_PADDLE_X,
  TICK_RATE,
  type PongState,
} from '@littlegames/pong-logic';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { drawNumber } from './segment-digits.ts';

function messageFor(state: PongState): string {
  switch (state.phase) {
    case 'waiting':
      return 'Waiting for an opponent';
    case 'finished':
      return state.winner === 'left' ? 'Left wins' : 'Right wins';
    default:
      return '';
  }
}

const BACKGROUND = 0x101319;
const FOREGROUND = 0xeef0f4;
const DIM = 0x39404f;

/**
 * Draws Pong with PixiJS.
 *
 * This is the only file in the project allowed to know PixiJS exists. It
 * receives a state and draws it; it holds no rules, no clock and no network,
 * which is what makes it replaceable by another engine.
 */
export function createPongPixiRenderer(): GameRenderer<PongState> {
  const app = new Application();
  // Everything is drawn in fixed field units inside this container, and the
  // container alone is scaled to the screen. Nothing downstream has to know the
  // display size.
  const field = new Container();
  const board = new Graphics();
  const leftPaddle = new Graphics();
  const rightPaddle = new Graphics();
  const ball = new Graphics();

  // Scores and the countdown are drawn as bars, not typeset. Words are the one
  // thing no arrangement of rectangles renders legibly, so they stay text, in a
  // monospace stack for want of anything squarer that is always installed.
  const numbers = new Graphics();
  const message = new Text({
    text: '',
    style: new TextStyle({
      fill: FOREGROUND,
      fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 32,
      fontWeight: '600',
    }),
  });

  let mounted = false;
  // What the numbers currently show. Rebuilding their geometry every frame
  // re-tessellates and re-uploads it sixty times a second for a score that
  // changes once a minute.
  let drawnNumbers = '';
  let drawnMessage = '';
  let lastWidth = 0;
  let lastHeight = 0;

  function drawStatics(): void {
    board.clear();
    board.rect(0, 0, FIELD_WIDTH, FIELD_HEIGHT).fill(BACKGROUND);
    // A dashed centre line, drawn once: it never moves.
    for (let y = 0; y < FIELD_HEIGHT; y += 32) {
      board.rect(FIELD_WIDTH / 2 - 2, y + 6, 4, 20).fill(DIM);
    }

    for (const [paddle, x] of [
      [leftPaddle, LEFT_PADDLE_X],
      [rightPaddle, RIGHT_PADDLE_X],
    ] as const) {
      paddle.clear();
      // Drawn around its own origin so that positioning it is a single
      // assignment to `y` per frame.
      paddle.rect(-PADDLE_WIDTH / 2, -PADDLE_HEIGHT / 2, PADDLE_WIDTH, PADDLE_HEIGHT).fill(FOREGROUND);
      paddle.x = x;
    }

    ball.clear();
    // Square, as the original was. The rules treat it as a circle of the same
    // radius, which is the more forgiving of the two and keeps the corners from
    // clipping a paddle the ball only just reached.
    ball.rect(-BALL_RADIUS, -BALL_RADIUS, BALL_RADIUS * 2, BALL_RADIUS * 2).fill(FOREGROUND);

    message.anchor.set(0.5);
    message.position.set(FIELD_WIDTH / 2, FIELD_HEIGHT / 2 + 120);
  }

  return {
    mount(container: HTMLElement): Promise<void> {
      // PixiJS 8 does not build a renderer in the constructor: without this
      // await there is no canvas and no GPU context at all.
      return app
        .init({
          background: BACKGROUND,
          antialias: true,
          // Matching the device pixel ratio keeps edges crisp on phones and
          // high-density laptops. Capped at 2: beyond that the backing store
          // grows quadratically for a difference nobody can see, and on a
          // three-times display in fullscreen it approaches the largest canvas
          // a browser will allocate.
          resolution: Math.min(globalThis.devicePixelRatio, 2),
          autoDensity: true,
          width: FIELD_WIDTH,
          height: FIELD_HEIGHT,
          // The game loop drives drawing. Left on, PixiJS would also render on
          // its own ticker, drawing states nobody asked for.
          autoStart: false,
        })
        .then(() => {
          drawStatics();
    field.addChild(board, leftPaddle, rightPaddle, ball, numbers, message);
          app.stage.addChild(field);
          container.append(app.canvas);
          mounted = true;
          return undefined;
        });
    },

    render(state: PongState): void {
      if (!mounted) {
        return;
      }

      leftPaddle.y = state.left.y;
      rightPaddle.y = state.right.y;
      ball.position.set(state.ball.x, state.ball.y);
      // The ball rests at the centre between points; hiding it there stops it
      // reading as a live ball nobody can reach.
      ball.visible = state.phase === 'playing';

      const countdown = state.phase === 'countdown' ? Math.ceil(state.phaseTicks / TICK_RATE) : 0;
      const wanted = `${String(state.score.left)}:${String(state.score.right)}:${String(countdown)}`;
      if (wanted !== drawnNumbers) {
        drawnNumbers = wanted;
        numbers.clear();
        drawNumber(numbers, state.score.left, FIELD_WIDTH / 2 - 90, 48, 84);
        drawNumber(numbers, state.score.right, FIELD_WIDTH / 2 + 90, 48, 84);
        if (countdown > 0) {
          drawNumber(numbers, countdown, FIELD_WIDTH / 2, FIELD_HEIGHT / 2 - 60, 120);
        }
        numbers.fill(FOREGROUND);
      }

      const wantedMessage = messageFor(state);
      if (wantedMessage !== drawnMessage) {
        // Assigning the same string still costs a text measurement.
        drawnMessage = wantedMessage;
        message.text = wantedMessage;
      }

      app.renderer.render(app.stage);
    },

    resize(width: number, height: number): void {
      if (!mounted) {
        return;
      }
      // A collapsed or unchanged box is not worth reallocating a drawing
      // surface for, and refusing to act on one is also what stops a resize
      // from feeding itself.
      if (width <= 0 || height <= 0 || (width === lastWidth && height === lastHeight)) {
        return;
      }
      lastWidth = width;
      lastHeight = height;
      app.renderer.resize(width, height);

      // Letterboxed rather than stretched: the field is a fixed shape, and
      // distorting it would give one player a taller paddle than the other.
      const scale = Math.min(width / FIELD_WIDTH, height / FIELD_HEIGHT);
      field.scale.set(scale);
      field.position.set(
        (width - FIELD_WIDTH * scale) / 2,
        (height - FIELD_HEIGHT * scale) / 2,
      );
    },

    destroy(): void {
      if (!mounted) {
        return;
      }
      mounted = false;
      drawnNumbers = '';
      drawnMessage = '';
      lastWidth = 0;
      lastHeight = 0;
      // Releasing the GPU context matters on mobile, where a leaked one can
      // cost the next match its renderer entirely.
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
