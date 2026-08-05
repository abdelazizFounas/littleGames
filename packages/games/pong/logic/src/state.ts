import {
  BALL_INITIAL_SPEED,
  COUNTDOWN_TICKS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
} from './constants.ts';

/** Which end of the field a player defends. */
export type Side = 'left' | 'right';

/**
 * Where a match is in its life.
 *
 * `pointScored` is a phase of its own rather than a flag, because the pause
 * after a point is simulated like any other: it advances tick by tick, so the
 * server and the clients agree on exactly when play resumes.
 */
export type MatchPhase = 'waiting' | 'countdown' | 'playing' | 'pointScored' | 'finished';

export interface Paddle {
  /** Centre of the paddle along the y axis. */
  readonly y: number;
}

export interface Ball {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Magnitude of the velocity, carried so a bounce can rebuild it exactly. */
  readonly speed: number;
}

export interface Score {
  readonly left: number;
  readonly right: number;
}

/** The complete simulation state. Everything else is derived from it. */
export interface PongState {
  readonly phase: MatchPhase;
  /** Ticks left in a timed phase. Zero outside `countdown` and `pointScored`. */
  readonly phaseTicks: number;
  readonly left: Paddle;
  readonly right: Paddle;
  readonly ball: Ball;
  readonly score: Score;
  /** Points completed so far, which chooses the serve angle. */
  readonly pointsPlayed: number;
  /** Side the next serve travels towards. */
  readonly serveTowards: Side;
  /** Winner, once the match is over. */
  readonly winner: Side | null;
}

/** What one player is pressing. Intent only, no position. */
export interface PaddleInput {
  readonly up: boolean;
  readonly down: boolean;
}

/** Both players' intent for a single tick. */
export interface PongInputs {
  readonly left: PaddleInput;
  readonly right: PaddleInput;
}

export const NO_INPUT: PaddleInput = { up: false, down: false };

/** A ball resting at the centre, as it sits between points. */
function restingBall(): Ball {
  return { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 0, vy: 0, speed: BALL_INITIAL_SPEED };
}

/**
 * The state a match starts in, before anyone has joined.
 *
 * Callers move it to `countdown` with `startCountdown` once both seats are
 * filled.
 */
export function createInitialState(): PongState {
  return {
    phase: 'waiting',
    phaseTicks: 0,
    left: { y: FIELD_HEIGHT / 2 },
    right: { y: FIELD_HEIGHT / 2 },
    ball: restingBall(),
    score: { left: 0, right: 0 },
    pointsPlayed: 0,
    serveTowards: 'right',
    winner: null,
  };
}

/** Begins the three-second countdown that precedes the first rally. */
export function startCountdown(state: PongState): PongState {
  return { ...state, phase: 'countdown', phaseTicks: COUNTDOWN_TICKS, ball: restingBall() };
}

export { restingBall };
