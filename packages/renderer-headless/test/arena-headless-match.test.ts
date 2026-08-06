import type { InputSource } from '@littlegames/core';
import {
  COUNTDOWN_TICKS,
  MAX_REWIND_TICKS,
  NO_INPUT,
  STAND_HEIGHT,
  TICK_RATE,
  WINNING_SCORE,
  createInitialState,
  eyePosition,
  historyAt,
  normalizeAim,
  startCountdown,
  step,
  type ArenaInput,
  type ArenaState,
  type Seat,
} from '@littlegames/arena-logic';
import { describe, expect, it } from 'vitest';
import { createHeadlessRenderer } from '../src/headless-renderer.ts';

/**
 * A full 1v1 with no browser, no engine and no network.
 *
 * This is the third game to be run this way, and the first in three dimensions.
 * It is the same proof each time and it is the one `SPEC.md` §3 asks for: if a
 * match plays to a winner against a renderer that draws nothing, then nothing
 * in the rules is reaching for a canvas, and Babylon can be added — or
 * replaced — without any of this moving.
 */

/** An arena command: one tick of intent, stamped for reconciliation. */
interface ArenaCommand extends ArenaInput {
  readonly seq: number;
}

/**
 * A player who stands still, aims at their opponent and pulls the trigger.
 *
 * Standing in for a human, and swapping one for the other is the same property
 * that lets a keyboard, a touch surface or a scripted opponent drive the game:
 * the rules only ever see typed commands.
 */
function createDuellist(seat: Seat, readState: () => ArenaState): InputSource<ArenaCommand> {
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
      const shooter = seat === 'north' ? state.north : state.south;
      const targetSeat: Seat = seat === 'north' ? 'south' : 'north';
      const target = targetSeat === 'north' ? state.north : state.south;
      const eye = eyePosition(shooter.body);

      // Aimed through the history ring, exactly as a real client would: what a
      // shooter sees is always a little behind where the target has got to.
      const back = MAX_REWIND_TICKS - 4;
      const frame = historyAt(state, back);
      const seen = targetSeat === 'north' ? frame.north : frame.south;

      return {
        seq,
        move: { x: 0, z: 0 },
        aim: normalizeAim({
          x: seen.x - eye.x,
          y: seen.y + STAND_HEIGHT / 2 - eye.y,
          z: seen.z - eye.z,
        }),
        jump: false,
        crouch: false,
        fire: target.alive && shooter.alive,
        rewindTicks: back,
      };
    },
    stop() {
      started = false;
    },
  };
}

/** A player who does nothing at all, so the match reaches an end. */
function createBystander(): InputSource<ArenaCommand> {
  return {
    start() {
      /* nothing to observe */
    },
    sample: (seq) => ({ ...NO_INPUT, seq }),
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
function runFiveHundredTicks(render: boolean): ArenaState {
  let state = startCountdown(createInitialState(), COUNTDOWN_TICKS);
  const renderer = createHeadlessRenderer<ArenaState>();
  const south = createDuellist('south', () => state);
  south.start();
  for (let tick = 0; tick < 500; tick += 1) {
    state = step(state, { north: NO_INPUT, south: south.sample(tick) }).state;
    if (render) {
      renderer.render(state, tick / TICK_RATE);
    }
  }
  return state;
}

describe('a full match, headless', () => {
  it('plays to the winning score with no browser and no network', async () => {
    let state = startCountdown(createInitialState(), COUNTDOWN_TICKS);
    const renderer = createHeadlessRenderer<ArenaState>();
    const south = createDuellist('south', () => state);
    // An opponent who never returns fire, so the match reaches an end rather
    // than trading indefinitely between two equally accurate scripts.
    const north = createBystander();

    await renderer.mount(containerStub());
    renderer.resize(1920, 1080);
    south.start();
    north.start();

    // A hard ceiling, so a rules change that makes a match unwinnable fails
    // here instead of hanging the suite.
    const tickLimit = TICK_RATE * 60 * 10;
    let ticks = 0;
    let shotsFired = 0;

    while (state.phase !== 'finished' && ticks < tickLimit) {
      const result = step(state, { north: north.sample(ticks), south: south.sample(ticks) });
      state = result.state;
      shotsFired += result.shots.length;
      renderer.render(state, 0);
      ticks += 1;
    }

    south.stop();
    north.stop();
    renderer.destroy();

    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('south');
    expect(state.south.score).toBe(WINNING_SCORE);
    expect(state.north.score).toBe(0);
    expect(shotsFired).toBeGreaterThanOrEqual(WINNING_SCORE);
    expect(ticks).toBeLessThan(tickLimit);

    // The renderer saw every frame, and the last one is the finished match.
    expect(renderer.frameCount).toBe(ticks);
    expect(renderer.lastState).toEqual(state);
    expect(renderer.size).toEqual({ width: 1920, height: 1080 });
    expect(renderer.destroyed).toBe(true);
  });

  it('draws nothing, so the match is unaffected by whether anyone is watching', () => {
    expect(runFiveHundredTicks(true)).toEqual(runFiveHundredTicks(false));
  });
});
