import {
  BALL_INITIAL_SPEED,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_SPEED_GAIN,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  LEFT_PADDLE_X,
  MAX_BOUNCE_RATIO,
  PADDLE_HEIGHT,
  PADDLE_SPEED,
  PADDLE_WIDTH,
  POINT_PAUSE_TICKS,
  RIGHT_PADDLE_X,
  SERVE_VERTICAL_RATIOS,
  TICK_SECONDS,
  WINNING_SCORE,
} from './constants.ts';
import type { Ball, Paddle, PaddleInput, PongInputs, PongState, Side } from './state.ts';

const HALF_PADDLE = PADDLE_HEIGHT / 2;
const PADDLE_MIN_Y = HALF_PADDLE;
const PADDLE_MAX_Y = FIELD_HEIGHT - HALF_PADDLE;

/** Plane the ball's centre must reach to be blocked, on each side. */
const LEFT_CONTACT_X = LEFT_PADDLE_X + PADDLE_WIDTH / 2 + BALL_RADIUS;
const RIGHT_CONTACT_X = RIGHT_PADDLE_X - PADDLE_WIDTH / 2 - BALL_RADIUS;

/** Vertical reach of a paddle against the ball's centre. */
const CONTACT_REACH = HALF_PADDLE + BALL_RADIUS;

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  return value > max ? max : value;
}

function movePaddle(paddle: Paddle, input: PaddleInput): Paddle {
  const direction = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (direction === 0) {
    return paddle;
  }
  const moved = paddle.y + direction * PADDLE_SPEED * TICK_SECONDS;
  return { y: clamp(moved, PADDLE_MIN_Y, PADDLE_MAX_Y) };
}

/**
 * Rebuilds the velocity after a paddle hit.
 *
 * Where the ball met the paddle decides how steeply it leaves: dead centre
 * sends it straight back, the edges angle it away. The horizontal component
 * comes from a square root rather than a cosine on purpose — square root is
 * exactly rounded by IEEE-754 in both languages, while trigonometry is not, and
 * the Go port has to agree with this to the last bit.
 */
function deflect(ball: Ball, paddleY: number, towards: Side): Ball {
  const offset = clamp((ball.y - paddleY) / HALF_PADDLE, -1, 1);
  const verticalRatio = offset * MAX_BOUNCE_RATIO;
  const horizontalRatio = Math.sqrt(1 - verticalRatio * verticalRatio);
  const speed = Math.min(ball.speed * BALL_SPEED_GAIN, BALL_MAX_SPEED);
  const horizontalSign = towards === 'right' ? 1 : -1;

  return {
    x: towards === 'right' ? LEFT_CONTACT_X : RIGHT_CONTACT_X,
    y: ball.y,
    vx: horizontalSign * horizontalRatio * speed,
    vy: verticalRatio * speed,
    speed,
  };
}

/** The ball as it leaves the centre to open a point. */
function serve(pointsPlayed: number, towards: Side): Ball {
  const ratio = SERVE_VERTICAL_RATIOS[pointsPlayed % SERVE_VERTICAL_RATIOS.length] ?? 0;
  const horizontalRatio = Math.sqrt(1 - ratio * ratio);
  const horizontalSign = towards === 'right' ? 1 : -1;

  return {
    x: FIELD_WIDTH / 2,
    y: FIELD_HEIGHT / 2,
    vx: horizontalSign * horizontalRatio * BALL_INITIAL_SPEED,
    vy: ratio * BALL_INITIAL_SPEED,
    speed: BALL_INITIAL_SPEED,
  };
}

/** Reflects the ball off the top and bottom walls. */
function bounceOffWalls(ball: Ball): Ball {
  if (ball.y < BALL_RADIUS) {
    // Mirror the overshoot back into the field rather than snapping to the
    // wall, so a fast ball keeps the distance it actually travelled.
    return { ...ball, y: BALL_RADIUS + (BALL_RADIUS - ball.y), vy: -ball.vy };
  }
  const bottom = FIELD_HEIGHT - BALL_RADIUS;
  if (ball.y > bottom) {
    return { ...ball, y: bottom - (ball.y - bottom), vy: -ball.vy };
  }
  return ball;
}

/**
 * Returns the deflected ball if a paddle blocked it this tick, otherwise null.
 *
 * The test is on crossing a plane between the previous position and this one,
 * not on overlapping it. At speed the ball covers more than its own diameter in
 * a tick, and an overlap test would let it tunnel straight through the paddle.
 */
function blockedByPaddle(ball: Ball, previousX: number, left: Paddle, right: Paddle): Ball | null {
  if (ball.vx < 0 && previousX >= LEFT_CONTACT_X && ball.x <= LEFT_CONTACT_X) {
    if (Math.abs(ball.y - left.y) <= CONTACT_REACH) {
      return deflect(ball, left.y, 'right');
    }
  }
  if (ball.vx > 0 && previousX <= RIGHT_CONTACT_X && ball.x >= RIGHT_CONTACT_X) {
    if (Math.abs(ball.y - right.y) <= CONTACT_REACH) {
      return deflect(ball, right.y, 'left');
    }
  }
  return null;
}

/** The side that conceded, or null while the ball is still in play. */
function concededSide(ball: Ball): Side | null {
  if (ball.x + BALL_RADIUS < 0) {
    return 'left';
  }
  return ball.x - BALL_RADIUS > FIELD_WIDTH ? 'right' : null;
}

/**
 * Advances the simulation by exactly one tick.
 *
 * Pure: the same state and the same inputs always produce the same next state,
 * which is what lets the server, a client predicting ahead, and a test all
 * agree.
 */
export function step(state: PongState, inputs: PongInputs): PongState {
  if (state.phase === 'waiting' || state.phase === 'finished') {
    return state;
  }

  // Paddles answer during the countdown and the pause after a point too, so a
  // player can take position before the serve.
  const left = movePaddle(state.left, inputs.left);
  const right = movePaddle(state.right, inputs.right);

  if (state.phase === 'countdown' || state.phase === 'pointScored') {
    const phaseTicks = state.phaseTicks - 1;
    if (phaseTicks > 0) {
      return { ...state, left, right, phaseTicks };
    }
    return {
      ...state,
      left,
      right,
      phase: 'playing',
      phaseTicks: 0,
      ball: serve(state.pointsPlayed, state.serveTowards),
    };
  }

  const previousX = state.ball.x;
  const travelled: Ball = {
    ...state.ball,
    x: state.ball.x + state.ball.vx * TICK_SECONDS,
    y: state.ball.y + state.ball.vy * TICK_SECONDS,
  };
  const afterWalls = bounceOffWalls(travelled);
  const ball = blockedByPaddle(afterWalls, previousX, left, right) ?? afterWalls;

  const conceded = concededSide(ball);
  if (conceded === null) {
    return { ...state, left, right, ball };
  }

  const score =
    conceded === 'left'
      ? { left: state.score.left, right: state.score.right + 1 }
      : { left: state.score.left + 1, right: state.score.right };
  const pointsPlayed = state.pointsPlayed + 1;
  const winner: Side | null =
    score.left >= WINNING_SCORE ? 'left' : score.right >= WINNING_SCORE ? 'right' : null;

  return {
    ...state,
    left,
    right,
    // The ball rests at the centre between points, so nothing is in flight
    // while the score is being read.
    ball: { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 0, vy: 0, speed: BALL_INITIAL_SPEED },
    score,
    pointsPlayed,
    // The player who conceded receives the next serve.
    serveTowards: conceded,
    phase: winner === null ? 'pointScored' : 'finished',
    phaseTicks: winner === null ? POINT_PAUSE_TICKS : 0,
    winner,
  };
}
