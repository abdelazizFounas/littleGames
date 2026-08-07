import type { Seat, Vec3 } from '@littlegames/arena-logic';
import type { GameRenderer } from '@littlegames/core';

/**
 * What the renderer is asked to draw, and the only thing it is told.
 *
 * A view is a finished picture: every position in it has already been predicted,
 * interpolated and smoothed by whoever composed it. The renderer holds no
 * clock, no rules and no network, which is what makes it replaceable by another
 * engine — and what keeps prediction from straddling the boundary that exists
 * to keep the engine out.
 */
export interface ArenaView {
  readonly camera: ArenaCamera;
  /**
   * The bodies to draw.
   *
   * The local player's own is normally absent: the camera is inside it, and a
   * box drawn around one's own eyes fills the screen with its inside faces.
   */
  readonly players: readonly ArenaPlayerView[];
  /** Shots still worth drawing, newest last. */
  readonly shots: readonly ArenaShotView[];
  readonly hud: ArenaHud;
}

/**
 * One shot the server resolved, as a line to draw.
 *
 * It carries its own age rather than a timestamp, because the renderer holds no
 * clock: whoever composes the view knows when the shot was first seen, and the
 * renderer only needs to know how far through its life it is.
 */
export interface ArenaShotView {
  readonly id: number;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly hitPlayer: boolean;
  /** Zero when just fired, one when it should be gone. */
  readonly fade: number;
}

/**
 * Where the eye is and which way it looks.
 *
 * The renderer does not own this. Whoever composes the view computes it from
 * their own prediction and hands it over, so the camera is a value like any
 * other rather than a piece of engine state the session has to reach into.
 */
export interface ArenaCamera {
  /** Eye position in world metres. */
  readonly position: Vec3;
  /** Unit vector the eye looks along. */
  readonly forward: Vec3;
  /** Vertical field of view, in radians. */
  readonly fieldOfView: number;
}

export interface ArenaPlayerView {
  readonly seat: Seat;
  /** Feet, as the rules hold it. */
  readonly position: Vec3;
  readonly crouching: boolean;
  /** A dead body is not drawn, but it is still in the view so it can fade. */
  readonly alive: boolean;
}

/** The three numbers over the canvas, and the words that replace them. */
export interface ArenaHud {
  readonly ownScore: number;
  readonly opponentScore: number;
  /** Shown instead of the crosshair: waiting, the countdown, a result. */
  readonly message: string;
  /** Seconds until this player is back on their feet. Zero while alive. */
  readonly respawnSeconds: number;
  readonly crosshair: boolean;
  /**
   * How strongly to mark a shot of this player's that connected, from one down
   * to nothing. It is the only confirmation a shooter gets: the target is a box
   * that does not stagger, and at this range a miss looks the same as a hit.
   */
  readonly hitMarker: number;
  /** How strongly to show that this player was hit, from one down to nothing. */
  readonly damage: number;
}

/**
 * A renderer that owns a drawing surface the screen needs to reach.
 *
 * Exactly one member more than `GameRenderer`, and it is not a convenience: a
 * first-person game asks for pointer lock on an element, and a touch layout
 * attaches its gestures to one. Both are properties of the surface rather than
 * of the drawing, so the alternative would be for the screen to guess which
 * element the engine created.
 */
export interface ArenaRenderer extends GameRenderer<ArenaView> {
  /** The element drawn into, or null before `mount` and after `destroy`. */
  readonly canvas: HTMLCanvasElement | null;
}
