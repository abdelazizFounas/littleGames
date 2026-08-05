import type { GameRenderer } from '@littlegames/core';

/**
 * A renderer that draws nothing and records what it was asked to draw.
 *
 * Its existence is the proof that the rendering contract is real: if a game can
 * be played to completion against this, then nothing in the game reaches for a
 * canvas, a GPU or a browser, and a second engine can be added later without
 * touching the rules.
 */
export interface HeadlessRenderer<TState> extends GameRenderer<TState> {
  /** Number of frames drawn since mounting. */
  readonly frameCount: number;
  /** The most recent state handed to `render`, or null before the first frame. */
  readonly lastState: TState | null;
  /** The most recent size passed to `resize`. */
  readonly size: { readonly width: number; readonly height: number };
  readonly mounted: boolean;
  readonly destroyed: boolean;
}

export function createHeadlessRenderer<TState>(): HeadlessRenderer<TState> {
  let frameCount = 0;
  let lastState: TState | null = null;
  let width = 0;
  let height = 0;
  let mounted = false;
  let destroyed = false;

  return {
    get frameCount() {
      return frameCount;
    },
    get lastState() {
      return lastState;
    },
    get size() {
      return { width, height };
    },
    get mounted() {
      return mounted;
    },
    get destroyed() {
      return destroyed;
    },

    mount(): Promise<void> {
      // The container is deliberately ignored. A real engine attaches a canvas
      // to it; there is nothing here to attach.
      mounted = true;
      return Promise.resolve();
    },
    render(state: TState): void {
      lastState = state;
      frameCount += 1;
    },
    resize(nextWidth: number, nextHeight: number): void {
      width = nextWidth;
      height = nextHeight;
    },
    destroy(): void {
      mounted = false;
      destroyed = true;
    },
  };
}
