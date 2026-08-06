import { describe, expect, it } from 'vitest';
import {
  BALL_INITIAL_SPEED,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_SPEED_GAIN,
  COUNTDOWN_TICKS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  LEFT_PADDLE_X,
  MAX_BOUNCE_RATIO,
  PADDLE_HEIGHT,
  PADDLE_SPEED,
  PADDLE_WIDTH,
  POINT_PAUSE_TICKS,
  TICK_SECONDS,
  WINNING_SCORE,
} from '../src/constants.ts';
import { NO_INPUT, createInitialState, startCountdown, type PongState } from '../src/state.ts';
import { step } from '../src/step.ts';

const IDLE = { left: NO_INPUT, right: NO_INPUT };
const HOLD_UP = { up: true, down: false };
const HOLD_DOWN = { up: false, down: true };

/** A state mid-rally, with the ball placed and moving as the test needs. */
function playing(overrides: Partial<PongState> = {}): PongState {
  return {
    ...createInitialState(),
    phase: 'playing',
    ...overrides,
  };
}

function speedOf(vx: number, vy: number): number {
  return Math.sqrt(vx * vx + vy * vy);
}

describe('phases', () => {
  it('freezes while waiting for players', () => {
    const state = createInitialState();

    expect(step(state, { left: HOLD_UP, right: HOLD_DOWN })).toBe(state);
  });

  it('runs the countdown for exactly three seconds, then serves', () => {
    let state = startCountdown(createInitialState());
    expect(state.phaseTicks).toBe(COUNTDOWN_TICKS);

    for (let tick = 0; tick < COUNTDOWN_TICKS - 1; tick += 1) {
      state = step(state, IDLE);
      expect(state.phase).toBe('countdown');
    }

    state = step(state, IDLE);
    expect(state.phase).toBe('playing');
    expect(speedOf(state.ball.vx, state.ball.vy)).toBeCloseTo(BALL_INITIAL_SPEED, 9);
  });

  it('lets paddles take position during the countdown', () => {
    const state = step(startCountdown(createInitialState()), { left: HOLD_UP, right: NO_INPUT });

    expect(state.left.y).toBeLessThan(FIELD_HEIGHT / 2);
  });

  it('freezes once the match is finished', () => {
    const state = playing({ phase: 'finished', winner: 'left' });

    expect(step(state, { left: HOLD_UP, right: HOLD_DOWN })).toBe(state);
  });
});

describe('paddles', () => {
  it('moves at the configured speed for one tick', () => {
    const state = step(playing(), { left: HOLD_DOWN, right: NO_INPUT });

    expect(state.left.y).toBeCloseTo(FIELD_HEIGHT / 2 + PADDLE_SPEED * TICK_SECONDS, 9);
  });

  it('does not move without input', () => {
    expect(step(playing(), IDLE).left.y).toBe(FIELD_HEIGHT / 2);
  });

  it('cancels opposite directions held together', () => {
    expect(step(playing(), { left: { up: true, down: true }, right: NO_INPUT }).left.y).toBe(
      FIELD_HEIGHT / 2,
    );
  });

  it('stops at the top and bottom walls', () => {
    let state = playing();
    for (let tick = 0; tick < 200; tick += 1) {
      state = step(state, { left: HOLD_UP, right: HOLD_DOWN });
    }

    expect(state.left.y).toBe(PADDLE_HEIGHT / 2);
    expect(state.right.y).toBe(FIELD_HEIGHT - PADDLE_HEIGHT / 2);
  });
});

describe('walls', () => {
  it('reflects the ball off the top', () => {
    const state = step(
      playing({ ball: { x: 400, y: BALL_RADIUS + 1, vx: 0, vy: -300, speed: 300 } }),
      IDLE,
    );

    expect(state.ball.vy).toBe(300);
    expect(state.ball.y).toBeGreaterThanOrEqual(BALL_RADIUS);
  });

  it('reflects the ball off the bottom', () => {
    const state = step(
      playing({ ball: { x: 400, y: FIELD_HEIGHT - BALL_RADIUS - 1, vx: 0, vy: 300, speed: 300 } }),
      IDLE,
    );

    expect(state.ball.vy).toBe(-300);
    expect(state.ball.y).toBeLessThanOrEqual(FIELD_HEIGHT - BALL_RADIUS);
  });

  it('keeps the distance actually travelled instead of snapping to the wall', () => {
    // A ball 1 unit from the wall moving 10 units per tick should end up 9
    // units back inside it, not resting against it.
    const state = step(
      playing({ ball: { x: 400, y: BALL_RADIUS + 1, vx: 0, vy: -10 / TICK_SECONDS, speed: 300 } }),
      IDLE,
    );

    expect(state.ball.y).toBeCloseTo(BALL_RADIUS + 9, 9);
  });
});

describe('paddle deflection', () => {
  const contactX = LEFT_PADDLE_X + PADDLE_WIDTH / 2 + BALL_RADIUS;
  /** How far from a paddle's centre the ball's centre can be and still be met. */
  const CONTACT_REACH = PADDLE_HEIGHT / 2 + BALL_RADIUS;

  it('sends a centred hit straight back', () => {
    const state = step(
      playing({
        left: { y: 300 },
        ball: { x: contactX + 5, y: 300, vx: -300, vy: 0, speed: 300 },
      }),
      IDLE,
    );

    expect(state.ball.vx).toBeGreaterThan(0);
    expect(state.ball.vy).toBeCloseTo(0, 9);
  });

  it('angles a hit taken off the paddle edge', () => {
    const state = step(
      playing({
        left: { y: 300 },
        ball: { x: contactX + 5, y: 300 + PADDLE_HEIGHT / 2, vx: -300, vy: 0, speed: 300 },
      }),
      IDLE,
    );

    expect(state.ball.vx).toBeGreaterThan(0);
    expect(state.ball.vy).toBeGreaterThan(0);
  });

  it('speeds the ball up on every exchange', () => {
    const state = step(
      playing({
        left: { y: 300 },
        ball: { x: contactX + 5, y: 300, vx: -300, vy: 0, speed: 300 },
      }),
      IDLE,
    );

    expect(state.ball.speed).toBeCloseTo(300 * BALL_SPEED_GAIN, 9);
    expect(speedOf(state.ball.vx, state.ball.vy)).toBeCloseTo(state.ball.speed, 9);
  });

  it('never exceeds the speed ceiling', () => {
    const state = step(
      playing({
        left: { y: 300 },
        ball: { x: contactX + 5, y: 300, vx: -BALL_MAX_SPEED, vy: 0, speed: BALL_MAX_SPEED },
      }),
      IDLE,
    );

    expect(state.ball.speed).toBe(BALL_MAX_SPEED);
  });

  it('blocks a ball fast enough to clear the paddle within one tick', () => {
    // Fast enough to travel well past the paddle in a single step. An overlap
    // test would miss it entirely and concede a point through solid material.
    const state = step(
      playing({
        left: { y: 300 },
        ball: { x: contactX + 5, y: 300, vx: -BALL_MAX_SPEED, vy: 0, speed: BALL_MAX_SPEED },
      }),
      IDLE,
    );

    expect(state.ball.vx).toBeGreaterThan(0);
    expect(state.score).toEqual({ left: 0, right: 0 });
  });

  it('lets the ball past when the paddle is out of reach', () => {
    const state = step(
      playing({
        left: { y: 100 },
        ball: { x: contactX + 5, y: 500, vx: -300, vy: 0, speed: 300 },
      }),
      IDLE,
    );

    expect(state.ball.vx).toBeLessThan(0);
  });

  /**
   * A ball at top speed and the steepest angle a paddle can give it, arranged
   * to cross the paddle's plane exactly halfway through a tick.
   *
   * It climbs 24 units in that tick, so where it is when it crosses and where
   * it is when the tick ends are 12 units apart — nearly a quarter of the
   * paddle's reach. Which of the two the rule asks about decides these cases.
   */
  const steepArrival = (): { ball: PongState['ball']; crossesAt: number; endsAt: number } => {
    const vy = -MAX_BOUNCE_RATIO * BALL_MAX_SPEED;
    const vx = -Math.sqrt(1 - MAX_BOUNCE_RATIO * MAX_BOUNCE_RATIO) * BALL_MAX_SPEED;
    const crossesAt = 300;
    const startY = crossesAt - (vy * TICK_SECONDS) / 2;

    return {
      ball: {
        x: contactX - (vx * TICK_SECONDS) / 2,
        y: startY,
        vx,
        vy,
        speed: BALL_MAX_SPEED,
      },
      crossesAt,
      endsAt: startY + vy * TICK_SECONDS,
    };
  };

  it('blocks a steep ball that has climbed past the paddle by the end of the tick', () => {
    const { ball, crossesAt, endsAt } = steepArrival();
    // In reach at the moment of contact, and six units out of it by the time
    // the tick is over. Asking the question at the end of the tick is how a
    // ball goes through solid material.
    const paddleY = crossesAt + CONTACT_REACH - 6;
    expect(Math.abs(crossesAt - paddleY)).toBeLessThan(CONTACT_REACH);
    expect(Math.abs(endsAt - paddleY)).toBeGreaterThan(CONTACT_REACH);

    const state = step(playing({ left: { y: paddleY }, ball }), IDLE);

    expect(state.ball.vx).toBeGreaterThan(0);
    expect(state.score).toEqual({ left: 0, right: 0 });
  });

  it('lets a steep ball past when it was out of reach at the moment it crossed', () => {
    const { ball, crossesAt, endsAt } = steepArrival();
    // The mirror, and the reason this cannot be fixed by widening the reach:
    // out of reach when it crosses, and only drifting into line afterwards.
    const paddleY = endsAt - CONTACT_REACH + 6;
    expect(Math.abs(crossesAt - paddleY)).toBeGreaterThan(CONTACT_REACH);
    expect(Math.abs(endsAt - paddleY)).toBeLessThan(CONTACT_REACH);

    const state = step(playing({ left: { y: paddleY }, ball }), IDLE);

    expect(state.ball.vx).toBeLessThan(0);
  });

  it('measures the paddle where it was when the ball arrived, not after', () => {
    // The same error on the other body. A paddle crosses fourteen units in a
    // tick; held away from the ball it is in reach when the ball arrives and
    // out of it by the end, and taking the later position rules out a block the
    // player had already earned.
    const paddleTravel = PADDLE_SPEED * TICK_SECONDS;
    const start = 300;
    const whenTheBallArrives = start - paddleTravel / 2;
    const ballY = whenTheBallArrives + CONTACT_REACH - 3;
    expect(Math.abs(ballY - whenTheBallArrives)).toBeLessThan(CONTACT_REACH);
    expect(Math.abs(ballY - (start - paddleTravel))).toBeGreaterThan(CONTACT_REACH);

    const state = step(
      playing({
        left: { y: start },
        // Crossing the plane halfway through the tick, level all the way.
        ball: { x: contactX + 300 * TICK_SECONDS * 0.5, y: ballY, vx: -300, vy: 0, speed: 300 },
      }),
      { left: HOLD_UP, right: NO_INPUT },
    );

    expect(state.ball.vx).toBeGreaterThan(0);
  });
});

describe('scoring', () => {
  it('awards the point to the far side when the ball leaves the field', () => {
    const state = step(
      playing({ ball: { x: BALL_RADIUS, y: 300, vx: -1000, vy: 0, speed: 1000 } }),
      IDLE,
    );

    expect(state.score).toEqual({ left: 0, right: 1 });
    expect(state.phase).toBe('pointScored');
    expect(state.phaseTicks).toBe(POINT_PAUSE_TICKS);
  });

  it('serves towards whoever conceded', () => {
    const state = step(
      playing({ ball: { x: BALL_RADIUS, y: 300, vx: -1000, vy: 0, speed: 1000 } }),
      IDLE,
    );

    expect(state.serveTowards).toBe('left');
  });

  it('rests the ball at the centre between points', () => {
    const state = step(
      playing({ ball: { x: BALL_RADIUS, y: 300, vx: -1000, vy: 0, speed: 1000 } }),
      IDLE,
    );

    expect(state.ball).toEqual({
      x: FIELD_WIDTH / 2,
      y: FIELD_HEIGHT / 2,
      vx: 0,
      vy: 0,
      speed: BALL_INITIAL_SPEED,
    });
  });

  it('resumes play after the pause', () => {
    let state = step(
      playing({ ball: { x: BALL_RADIUS, y: 300, vx: -1000, vy: 0, speed: 1000 } }),
      IDLE,
    );

    for (let tick = 0; tick < POINT_PAUSE_TICKS; tick += 1) {
      state = step(state, IDLE);
    }

    expect(state.phase).toBe('playing');
    expect(state.ball.vx).toBeLessThan(0);
  });

  it('finishes the match at the winning score', () => {
    const state = step(
      playing({
        score: { left: WINNING_SCORE - 1, right: 0 },
        ball: { x: FIELD_WIDTH - BALL_RADIUS, y: 300, vx: 1000, vy: 0, speed: 1000 },
      }),
      IDLE,
    );

    expect(state.score.left).toBe(WINNING_SCORE);
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('left');
  });
});

describe('determinism', () => {
  it('produces an identical result from an identical input', () => {
    const state = startCountdown(createInitialState());

    expect(step(state, { left: HOLD_UP, right: HOLD_DOWN })).toEqual(
      step(state, { left: HOLD_UP, right: HOLD_DOWN }),
    );
  });

  it('replays a long sequence to the same state, bit for bit', () => {
    const run = (): PongState => {
      let state = startCountdown(createInitialState());
      for (let tick = 0; tick < 1200; tick += 1) {
        // A repeating pattern rather than a random one: the point is that the
        // simulation carries no hidden state of its own.
        const left = tick % 7 < 3 ? HOLD_UP : HOLD_DOWN;
        const right = tick % 5 < 2 ? HOLD_DOWN : HOLD_UP;
        state = step(state, { left, right });
      }
      return state;
    };

    expect(run()).toEqual(run());
  });

  it('never mutates the state it was given', () => {
    const state = startCountdown(createInitialState());
    const before = structuredClone(state);

    step(state, { left: HOLD_UP, right: HOLD_DOWN });

    expect(state).toEqual(before);
  });
});
