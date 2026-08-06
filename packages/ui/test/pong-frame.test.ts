import { FIELD_HEIGHT, FIELD_WIDTH, createInitialState, type PongState } from '@littlegames/pong-logic';
import { describe, expect, it } from 'vitest';
import {
  composeFrame,
  isContinuous,
  type AuthoritativeFrame,
} from '../src/features/game/pong-frame';

function frame(state: Partial<PongState>): AuthoritativeFrame {
  return {
    state: { ...createInitialState(), phase: 'playing', ...state },
    side: 'left',
    acknowledgedSeq: 0,
  };
}

const flying = (x: number, y: number): PongState['ball'] => ({
  x,
  y,
  vx: -400,
  vy: 100,
  speed: 412,
});

describe('drawing between two snapshots', () => {
  it('interpolates the ball and the opponent', () => {
    const drawn = composeFrame(
      frame({ ball: flying(200, 100), right: { y: 100 } }),
      frame({ ball: flying(100, 200), right: { y: 200 } }),
      0.5,
      'left',
      300,
    );

    expect(drawn.ball.x).toBe(150);
    expect(drawn.ball.y).toBe(150);
    expect(drawn.right.y).toBe(150);
  });

  it('leaves this player’s own paddle at the present', () => {
    const drawn = composeFrame(
      frame({ left: { y: 100 } }),
      frame({ left: { y: 200 } }),
      0.5,
      'left',
      555,
    );

    expect(drawn.left.y).toBe(555);
  });

  it('takes the score and the phase from the moment being drawn', () => {
    // The renderer hides the ball whenever the phase is not `playing`. Reading
    // the phase from the newest state instead would hide a ball that is still
    // being drawn a tenth of a second earlier — in front of the paddle it was
    // heading for, which is the ball appearing to vanish into it.
    const drawn = composeFrame(
      frame({ phase: 'playing', score: { left: 3, right: 4 }, ball: flying(60, 300) }),
      frame({ phase: 'pointScored', score: { left: 3, right: 5 } }),
      0.9,
      'left',
      300,
    );

    expect(drawn.phase).toBe('playing');
    expect(drawn.score).toEqual({ left: 3, right: 4 });
  });

  it('does not fly the ball backwards into the centre when a point ends', () => {
    // The snapshot that ends a point puts the ball back in the middle in the
    // same tick it leaves the field. Interpolating into that would send the ball
    // sailing back up the field, away from the wall it just went past.
    const conceded = frame({
      phase: 'pointScored',
      ball: { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 0, vy: 0, speed: 330 },
    });

    const drawn = composeFrame(frame({ ball: flying(20, 320) }), conceded, 0.5, 'left', 300);

    expect(drawn.ball.x).toBe(20);
    expect(drawn.ball.y).toBe(320);
  });

  it('holds still across the serve too, rather than blending two phases', () => {
    const drawn = composeFrame(
      frame({ phase: 'countdown', phaseTicks: 1 }),
      frame({ phase: 'playing', ball: flying(380, 300) }),
      0.5,
      'left',
      300,
    );

    expect(drawn.phase).toBe('countdown');
    expect(drawn.ball.x).toBe(FIELD_WIDTH / 2);
  });

  it('knows a continuous moment from a jump', () => {
    const playing = createInitialState();

    expect(isContinuous({ ...playing, phase: 'playing' }, { ...playing, phase: 'playing' })).toBe(
      true,
    );
    expect(
      isContinuous({ ...playing, phase: 'playing' }, { ...playing, phase: 'pointScored' }),
    ).toBe(false);
  });
});
