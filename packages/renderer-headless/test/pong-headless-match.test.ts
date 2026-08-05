import type { InputSource } from '@littlegames/core';
import {
  TICK_RATE,
  WINNING_SCORE,
  createInitialState,
  startCountdown,
  step,
  type PongState,
  type Side,
} from '@littlegames/pong-logic';
import { describe, expect, it } from 'vitest';
import { createHeadlessRenderer } from '../src/headless-renderer.ts';

/** A Pong command: intent for one tick, stamped for reconciliation. */
interface PongCommand {
  readonly seq: number;
  readonly up: boolean;
  readonly down: boolean;
}

/**
 * An `InputSource` that chases the ball, standing in for a player.
 *
 * Being able to swap a human for a script without the simulation noticing is
 * the same property that lets a keyboard, a touch surface or a test drive the
 * game: the rules only ever see typed commands.
 */
function createChasingPlayer(side: Side, readState: () => PongState): InputSource<PongCommand> {
  let started = false;
  return {
    start() {
      started = true;
    },
    sample(seq) {
      if (!started) {
        throw new Error('sample called before start');
      }
      const state = readState();
      const paddle = side === 'left' ? state.left : state.right;
      // Two-way rather than three-way on purpose. Standing perfectly still
      // when the ball is exactly level produces a horizontal rally that never
      // ends, because neither paddle ever moves off centre.
      const wantsUp = state.ball.y < paddle.y;
      return { seq, up: wantsUp, down: !wantsUp };
    },
    stop() {
      started = false;
    },
  };
}

/** An `InputSource` that never presses anything. */
function createIdlePlayer(): InputSource<PongCommand> {
  return {
    start() {
      /* nothing to observe */
    },
    sample: (seq) => ({ seq, up: false, down: false }),
    stop() {
      /* nothing to release */
    },
  };
}

/**
 * Node has no DOM, and the headless renderer never touches the container it is
 * handed. Rather than weaken the contract every browser renderer depends on,
 * the stub is asserted once, here, where the reason is visible.
 */
function containerStub(): HTMLElement {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {} as HTMLElement;
}

/** Plays a fixed stretch of match, optionally handing frames to a renderer. */
function runSixHundredTicks(render: boolean): PongState {
  let state = startCountdown(createInitialState());
  const renderer = createHeadlessRenderer<PongState>();
  for (let tick = 0; tick < 600; tick += 1) {
    const wantsUp = state.ball.y < state.left.y;
    state = step(state, {
      left: { up: wantsUp, down: !wantsUp },
      right: { up: false, down: false },
    });
    if (render) {
      renderer.render(state, tick / TICK_RATE);
    }
  }
  return state;
}

describe('a full match, headless', () => {
  it('plays to the winning score with no browser and no network', async () => {
    let state = startCountdown(createInitialState());
    const renderer = createHeadlessRenderer<PongState>();
    const left = createChasingPlayer('left', () => state);
    // An opponent who never moves, so the match reaches an end rather than
    // rallying between two equally good players indefinitely.
    const right = createIdlePlayer();

    await renderer.mount(containerStub());
    renderer.resize(1280, 960);
    left.start();
    right.start();

    // A hard ceiling, so a rules change that makes a match unwinnable fails
    // here instead of hanging the suite.
    const tickLimit = TICK_RATE * 60 * 10;
    let ticks = 0;

    while (state.phase !== 'finished' && ticks < tickLimit) {
      const leftCommand = left.sample(ticks);
      const rightCommand = right.sample(ticks);
      state = step(state, {
        left: { up: leftCommand.up, down: leftCommand.down },
        right: { up: rightCommand.up, down: rightCommand.down },
      });
      renderer.render(state, 0);
      ticks += 1;
    }

    left.stop();
    right.stop();
    renderer.destroy();

    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('left');
    expect(state.score.left).toBe(WINNING_SCORE);
    expect(ticks).toBeLessThan(tickLimit);

    // The renderer saw every frame, and the last one is the finished match.
    expect(renderer.frameCount).toBe(ticks);
    expect(renderer.lastState).toEqual(state);
    expect(renderer.size).toEqual({ width: 1280, height: 960 });
    expect(renderer.destroyed).toBe(true);
  });

  it('draws nothing, so the match is unaffected by whether anyone is watching', () => {
    expect(runSixHundredTicks(true)).toEqual(runSixHundredTicks(false));
  });
});
