import type { InputSource } from '@littlegames/core';

/** What a Pong player is asking for on a given tick. */
export interface PongCommand {
  readonly seq: number;
  readonly up: boolean;
  readonly down: boolean;
}

function keyDirection(key: string): 'up' | 'down' | null {
  if (key === 'ArrowUp' || key === 'w' || key === 'W') {
    return 'up';
  }
  if (key === 'ArrowDown' || key === 's' || key === 'S') {
    return 'down';
  }
  return null;
}

/**
 * Arrow keys and W/S.
 *
 * Held state is tracked rather than read at the moment of sampling, because a
 * key pressed and released between two samples still happened and would
 * otherwise be lost.
 */
export function createKeyboardInput(target: Window): InputSource<PongCommand> {
  let up = false;
  let down = false;

  const set = (event: KeyboardEvent, pressed: boolean): void => {
    const direction = keyDirection(event.key);
    if (direction === null) {
      return;
    }
    // Stops the page scrolling under the game while playing.
    event.preventDefault();
    if (direction === 'up') {
      up = pressed;
    } else {
      down = pressed;
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    set(event, true);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    set(event, false);
  };
  // A key held while the tab loses focus never sends its keyup, and the paddle
  // would run into the wall and stay there.
  const onBlur = (): void => {
    up = false;
    down = false;
  };

  return {
    start() {
      target.addEventListener('keydown', onKeyDown, { passive: false });
      target.addEventListener('keyup', onKeyUp);
      target.addEventListener('blur', onBlur);
    },
    sample: (seq) => ({ seq, up, down }),
    stop() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      up = false;
      down = false;
    },
  };
}

/**
 * A vertical drag surface, as the mobile brief asks for rather than a joystick.
 *
 * The finger names a target height on the surface and the paddle moves towards
 * it. That reads as direct control while still sending nothing but intent, so
 * the server stays the only authority on where the paddle actually is.
 */
export function createTouchInput(
  surface: HTMLElement,
  readPaddleRatio: () => number,
): InputSource<PongCommand> {
  let targetRatio: number | null = null;

  /** How close is close enough, as a fraction of the field's height. */
  const deadZone = 0.02;

  const track = (event: PointerEvent): void => {
    const bounds = surface.getBoundingClientRect();
    if (bounds.height === 0) {
      return;
    }
    targetRatio = Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1);
  };

  const onPointerDown = (event: PointerEvent): void => {
    // Capture keeps the paddle following a finger that slides off the canvas
    // instead of dropping the gesture there.
    surface.setPointerCapture(event.pointerId);
    track(event);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (targetRatio !== null) {
      track(event);
    }
  };
  const release = (): void => {
    targetRatio = null;
  };

  return {
    start() {
      surface.addEventListener('pointerdown', onPointerDown);
      surface.addEventListener('pointermove', onPointerMove);
      surface.addEventListener('pointerup', release);
      surface.addEventListener('pointercancel', release);
    },
    sample(seq) {
      if (targetRatio === null) {
        return { seq, up: false, down: false };
      }
      const difference = targetRatio - readPaddleRatio();
      if (Math.abs(difference) < deadZone) {
        return { seq, up: false, down: false };
      }
      return { seq, up: difference < 0, down: difference > 0 };
    },
    stop() {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', release);
      surface.removeEventListener('pointercancel', release);
      targetRatio = null;
    },
  };
}

/** Merges several sources, so keyboard and touch work at the same time. */
export function combineInputs(sources: InputSource<PongCommand>[]): InputSource<PongCommand> {
  return {
    start() {
      for (const source of sources) {
        source.start();
      }
    },
    sample(seq) {
      let up = false;
      let down = false;
      for (const source of sources) {
        const command = source.sample(seq);
        up = up || command.up;
        down = down || command.down;
      }
      return { seq, up, down };
    },
    stop() {
      for (const source of sources) {
        source.stop();
      }
    },
  };
}
