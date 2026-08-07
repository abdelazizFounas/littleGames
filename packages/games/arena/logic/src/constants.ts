/**
 * Every number the simulation runs on.
 *
 * All of them are metres, seconds, or ticks. The Go port declares the same
 * values as explicit `float64`s so that neither language's constant folding can
 * arrive anywhere the other does not: these two implementations are held to
 * identical bits by the conformance vectors, and a constant that differs in its
 * last place is the hardest kind of drift to find.
 */

/**
 * Simulation steps a second.
 *
 * Sixty rather than Pong's thirty, and Nakama's ceiling. What it buys is not
 * responsiveness of the camera — that turns at frame rate from local mouse
 * deltas — but a jitter buffer three ticks deep costing 50 ms instead of 100.
 * The opponent is therefore half as stale, which halves both how far a shooter
 * must lead a moving target and how far the server has to rewind to compensate.
 */
export const TICK_RATE = 60;

export const TICK_SECONDS = 1 / TICK_RATE;

/**
 * Scales the wire quantises movement and aim onto.
 *
 * Powers of two, so dividing an integer by one of them is exact in binary
 * floating point and lands on the identical double in both languages. That is
 * what lets a client predict from the very integers it put on the wire rather
 * than from the floats it computed them out of — the difference between a
 * prediction that settles and one that drifts by a hair every tick.
 */
export const MOVE_SCALE = 1024;
export const AIM_SCALE = 8192;

/** Widest a quantised component may be before the server rejects the frame. */
export const MAX_WIRE_MOVE = MOVE_SCALE * 2;
export const MAX_WIRE_AIM = AIM_SCALE * 2;

/* --- The arena, in metres ------------------------------------------------ */

/** Across, shared by both zones. The arena is symmetric about x = 0 too. */
export const ZONE_WIDTH = 20;

/** How deep one player's half is. */
export const ZONE_DEPTH = 10;

/** The impassable middle. Bullets cross it; players never do. */
export const GAP_DEPTH = 6;

export const HALF_WIDTH = ZONE_WIDTH / 2;
/** Front edge of a zone: where the ravine starts. */
export const ZONE_NEAR_Z = GAP_DEPTH / 2;
/** Back edge of a zone. */
export const ZONE_FAR_Z = ZONE_NEAR_Z + ZONE_DEPTH;

/** How high the walls and the invisible clip over the ravine stand. */
export const WALL_HEIGHT = 6;
export const WALL_THICKNESS = 1;

/* --- The player ----------------------------------------------------------- */

/** Half the width and half the depth of the body box. */
export const PLAYER_HALF = 0.4;

export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.1;

/** Where the camera and the muzzle sit above the feet. */
export const STAND_EYE = 1.6;
export const CROUCH_EYE = 0.9;

export const MOVE_SPEED = 5.5;
export const CROUCH_SPEED = 2.4;

/**
 * Downward acceleration.
 *
 * Well above the 9.81 of the world it is pretending to be. Real gravity makes a
 * jump that clears a crate hang in the air for most of a second, which reads as
 * floating rather than as jumping.
 */
export const GRAVITY = 22;

/**
 * Upward speed a jump starts with.
 *
 * Integrated a tick at a time this reaches about 1.22 m, which clears a
 * one-metre crate with enough margin to land on it while moving rather than
 * scraping the edge. The closed-form apex is a little higher; the discrete sum
 * is what the game actually does, and it is what the tests assert.
 */
export const JUMP_SPEED = 7.5;

/**
 * How far a player travels in one full stride cycle, in metres.
 *
 * The gait is driven by distance covered rather than by time, so a crouching
 * player takes the same steps over the same ground as a running one — just
 * fewer of them a second. It also means a player pressed against a wall stops
 * stepping, because they are not going anywhere.
 */
export const STRIDE_METRES = 2.4;

/**
 * Ground covered in one tick at a full run, in metres.
 *
 * What a whole step is measured against: cover this much and the stride is at
 * full size, cover half of it — a crouched walk does — and the steps are half
 * as long, with no separate rule needed for crouching.
 */
export const WALK_STEP_METRES = MOVE_SPEED * TICK_SECONDS;

/**
 * How fast the size of a step grows and shrinks, per tick.
 *
 * Without it a player who stops mid-stride freezes with one leg out in front,
 * which reads as a statue of somebody walking rather than as somebody standing.
 * About an eighth of a second either way, so a walk begins and ends rather than
 * switching on.
 */
export const GAIT_POWER_PER_TICK = 0.12;

/**
 * How much of the way into a crouch a body travels each tick.
 *
 * About an eighth of a second end to end. Instant would be cheaper and is what
 * this had before, but a hitbox that changes height between one tick and the
 * next is a hitbox nobody can see moving — and a player who drops behind cover
 * ought to be seen dropping.
 */
export const CROUCH_PER_TICK = 0.14;

/* --- Shooting ------------------------------------------------------------- */

/** Ticks between one shot and the next being allowed. */
export const FIRE_COOLDOWN_TICKS = 24;

/** Past this the ray stops looking, in metres. Longer than the arena. */
export const MAX_SHOT_DISTANCE = 80;

/* --- Rounds --------------------------------------------------------------- */

export const RESPAWN_TICKS = 90;
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
export const WINNING_SCORE = 7;

/* --- Lag compensation ----------------------------------------------------- */

/**
 * Furthest back the server will rewind a target to judge a shot.
 *
 * 250 ms. Past that, the victim's complaint — being killed after reaching cover
 * — outgrows the shooter's claim that the target was on their screen. It also
 * sets the depth of the history ring, which is fixed-size for that reason.
 */
export const MAX_REWIND_TICKS = 15;

/**
 * How far behind live a client draws the opponent, in ticks.
 *
 * Part of the rules rather than of the client because the server adds it to
 * every rewind: a shooter aimed at what their screen showed, and their screen
 * was this far behind the snapshot they had.
 */
export const INTERP_DELAY_TICKS = 3;
