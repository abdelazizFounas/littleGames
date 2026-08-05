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

function messageFor(state: PongState): string {
  switch (state.phase) {
    case 'waiting':
      return 'Waiting for an opponent';
    case 'countdown':
      return String(Math.ceil(state.phaseTicks / TICK_RATE));
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

  const scoreStyle = new TextStyle({
    fill: FOREGROUND,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 72,
    fontWeight: '700',
  });
  const messageStyle = new TextStyle({
    fill: FOREGROUND,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 36,
    fontWeight: '600',
  });
  const leftScore = new Text({ text: '0', style: scoreStyle });
  const rightScore = new Text({ text: '0', style: scoreStyle });
  const message = new Text({ text: '', style: messageStyle });

  let mounted = false;
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
      paddle
        .roundRect(-PADDLE_WIDTH / 2, -PADDLE_HEIGHT / 2, PADDLE_WIDTH, PADDLE_HEIGHT, 4)
        .fill(FOREGROUND);
      paddle.x = x;
    }

    ball.clear();
    // Square, as the original was. The rules treat it as a circle of the same
    // radius, which is the more forgiving of the two and keeps the corners from
    // clipping a paddle the ball only just reached.
    ball.rect(-BALL_RADIUS, -BALL_RADIUS, BALL_RADIUS * 2, BALL_RADIUS * 2).fill(FOREGROUND);

    leftScore.anchor.set(0.5);
    rightScore.anchor.set(0.5);
    leftScore.position.set(FIELD_WIDTH / 2 - 80, 70);
    rightScore.position.set(FIELD_WIDTH / 2 + 80, 70);

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
          field.addChild(board, leftPaddle, rightPaddle, ball, leftScore, rightScore, message);
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

      leftScore.text = String(state.score.left);
      rightScore.text = String(state.score.right);
      message.text = messageFor(state);

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
      lastWidth = 0;
      lastHeight = 0;
      // Releasing the GPU context matters on mobile, where a leaked one can
      // cost the next match its renderer entirely.
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
