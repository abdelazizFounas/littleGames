import type { PongState, Side } from '@littlegames/pong-logic';

/**
 * Choosing the single picture to draw from two authoritative states.
 *
 * Pulled out of the session loop because it is the one part of it that is worth
 * testing on its own: it decides what the player actually sees, it has two
 * awkward cases in it, and buried in a closure neither of them could be pinned
 * down.
 */

/** Snapshot as the client keeps it: the rules' state plus who we are in it. */
export interface AuthoritativeFrame {
  readonly state: PongState;
  readonly side: Side;
  readonly acknowledgedSeq: number;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/**
 * Two states describe a continuous moment when nothing between them was reset.
 *
 * The snapshot that ends a point puts the ball back at the centre in the same
 * tick as it leaves the field. Interpolating into that would draw the ball
 * flying backwards across the field to the middle, so a window straddling it
 * holds the earlier state instead and lets the ball be hidden a frame later.
 */
export function isContinuous(from: PongState, to: PongState): boolean {
  return from.phase === to.phase;
}

/**
 * Builds the frame to draw.
 *
 * Everything except this player's own paddle is taken from the interpolated
 * past, including the score, the phase and the countdown. Those cost nothing to
 * delay and everything to get out of step: the renderer hides the ball whenever
 * the phase is not `playing`, so a phase read from the newest state hides a ball
 * that is still being drawn a tenth of a second earlier — in front of the very
 * paddle it was heading for, which reads as the ball vanishing into it.
 *
 * The player's own paddle is the exception, and stays at the present. It answers
 * the keys directly, and a paddle that replied a tenth of a second late is the
 * one lag a player feels immediately.
 */
export function composeFrame(
  from: AuthoritativeFrame,
  to: AuthoritativeFrame,
  alpha: number,
  side: Side,
  predictedY: number,
): PongState {
  const continuous = isContinuous(from.state, to.state);
  const at = continuous ? alpha : 0;

  const interpolatedLeft = lerp(from.state.left.y, to.state.left.y, at);
  const interpolatedRight = lerp(from.state.right.y, to.state.right.y, at);

  return {
    // The discrete half of the state belongs to the moment being drawn.
    ...from.state,
    left: { y: side === 'left' ? predictedY : interpolatedLeft },
    right: { y: side === 'right' ? predictedY : interpolatedRight },
    ball: {
      ...from.state.ball,
      x: lerp(from.state.ball.x, to.state.ball.x, at),
      y: lerp(from.state.ball.y, to.state.ball.y, at),
    },
  };
}
