/**
 * Every dimension is in fixed logical units, never pixels.
 *
 * The field is the same size for everyone regardless of screen: scaling is the
 * renderer's job alone, so two players on very different displays simulate the
 * identical match.
 */
export const FIELD_WIDTH = 800;
export const FIELD_HEIGHT = 600;

/**
 * The simulation advances in whole ticks of this length and nothing else.
 *
 * Deriving movement from a frame time instead would make the outcome depend on
 * each machine's frame rate, and two clients would disagree with the server
 * within seconds.
 */
export const TICK_RATE = 30;
export const TICK_SECONDS = 1 / TICK_RATE;

export const PADDLE_WIDTH = 12;
export const PADDLE_HEIGHT = 96;
/** Gap between a paddle's outer edge and its side wall. */
export const PADDLE_INSET = 32;
/** Units per second. */
export const PADDLE_SPEED = 420;

/** Centre of each paddle along the x axis. */
export const LEFT_PADDLE_X = PADDLE_INSET + PADDLE_WIDTH / 2;
export const RIGHT_PADDLE_X = FIELD_WIDTH - PADDLE_INSET - PADDLE_WIDTH / 2;

export const BALL_RADIUS = 8;
export const BALL_INITIAL_SPEED = 330;
/** Multiplier applied on every paddle hit. */
export const BALL_SPEED_GAIN = 1.05;
/**
 * Ceiling on ball speed.
 *
 * Without it a long rally eventually moves the ball further than a paddle is
 * wide in a single tick, and it passes straight through.
 */
export const BALL_MAX_SPEED = 900;

/**
 * Steepest vertical component a paddle can impart, as a fraction of the ball's
 * speed.
 *
 * Strictly below 1 so the ball always keeps some horizontal travel and a rally
 * cannot stall into a vertical bounce nobody can reach.
 */
export const MAX_BOUNCE_RATIO = 0.8;

export const WINNING_SCORE = 11;

export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const POINT_PAUSE_TICKS = TICK_RATE;

/**
 * Vertical component of each serve, cycled by point number.
 *
 * A table rather than a random draw: both the server and every client must
 * produce the same serve from the same state, and a shared random generator is
 * one more thing that can drift between two languages.
 */
export const SERVE_VERTICAL_RATIOS = [0, 0.35, -0.35, 0.6, -0.6, 0.2, -0.2];
