import type { ArenaHud } from './view.ts';

/**
 * The crosshair, the score and the respawn timer.
 *
 * Three DOM elements over the canvas rather than anything drawn in the scene.
 * A crosshair rendered in 3D has to be placed in front of the near plane and
 * kept there; as an element it is simply in the middle of a box. It also keeps
 * the engine's own UI package out of the build entirely.
 *
 * They are updated by this module and never by React. A score that changes once
 * a minute must not cost a re-render sixty times a second, and the elements are
 * written to only when the text actually differs.
 */

export interface Hud {
  update: (state: ArenaHud) => void;
  destroy: () => void;
}

const FOREGROUND = '#eef0f4';

function overlay(): HTMLDivElement {
  const element = document.createElement('div');
  element.style.position = 'absolute';
  element.style.inset = '0';
  // The canvas underneath takes the pointer: this layer is a readout, and a
  // click that landed on it would be a click that never reached the game.
  element.style.pointerEvents = 'none';
  element.style.fontFamily = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
  element.style.color = FOREGROUND;
  element.style.userSelect = 'none';
  return element;
}

export function createHud(container: HTMLElement): Hud {
  // The overlay is positioned against the container, which the caller owns. It
  // is set here rather than assumed, because an absolutely positioned child of
  // a static parent escapes to the page.
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const root = overlay();

  const crosshair = document.createElement('div');
  crosshair.style.position = 'absolute';
  crosshair.style.left = '50%';
  crosshair.style.top = '50%';
  crosshair.style.width = '4px';
  crosshair.style.height = '4px';
  crosshair.style.margin = '-2px 0 0 -2px';
  crosshair.style.background = FOREGROUND;
  // A dark ring around it, so it survives being over a bright crate.
  crosshair.style.boxShadow = '0 0 0 1px rgba(0, 0, 0, 0.7)';

  const score = document.createElement('div');
  score.style.position = 'absolute';
  score.style.top = 'clamp(0.5rem, 2vmin, 1.5rem)';
  score.style.left = '50%';
  score.style.transform = 'translateX(-50%)';
  score.style.fontSize = 'clamp(1.5rem, 5vmin, 3rem)';
  score.style.fontWeight = '700';
  score.style.letterSpacing = '0.1em';
  score.style.textShadow = '0 2px 6px rgba(0, 0, 0, 0.6)';

  const message = document.createElement('div');
  message.style.position = 'absolute';
  message.style.top = '50%';
  message.style.left = '50%';
  message.style.transform = 'translate(-50%, -50%)';
  message.style.fontSize = 'clamp(1rem, 3.5vmin, 2rem)';
  message.style.fontWeight = '600';
  message.style.textAlign = 'center';
  message.style.textShadow = '0 2px 6px rgba(0, 0, 0, 0.6)';

  root.append(crosshair, score, message);
  container.appendChild(root);

  // What each element currently says. Writing textContent unconditionally
  // invalidates layout on every frame for text that rarely changes.
  let shownScore = '';
  let shownMessage = '';
  let shownCrosshair = true;

  return {
    update(state: ArenaHud): void {
      const nextScore = `${String(state.ownScore)} : ${String(state.opponentScore)}`;
      if (nextScore !== shownScore) {
        shownScore = nextScore;
        score.textContent = nextScore;
      }

      // The respawn timer takes the middle of the screen when there is one,
      // because being dead is the one thing worth interrupting the view for.
      const nextMessage =
        state.respawnSeconds > 0
          ? `Back in ${Math.ceil(state.respawnSeconds).toFixed(0)}`
          : state.message;
      if (nextMessage !== shownMessage) {
        shownMessage = nextMessage;
        message.textContent = nextMessage;
      }

      const wantsCrosshair = state.crosshair && state.respawnSeconds <= 0;
      if (wantsCrosshair !== shownCrosshair) {
        shownCrosshair = wantsCrosshair;
        crosshair.style.display = wantsCrosshair ? 'block' : 'none';
      }
    },

    destroy(): void {
      root.remove();
    },
  };
}
