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

  /**
   * Four ticks around the crosshair, shown when a shot connects.
   *
   * The confirmation a shooter has no other way of getting: the target is a box
   * that does not stagger or cry out, and from across the arena a miss and a
   * kill look exactly alike until the score changes a moment later.
   */
  const hitMarker = document.createElement('div');
  hitMarker.style.position = 'absolute';
  hitMarker.style.left = '50%';
  hitMarker.style.top = '50%';
  hitMarker.style.width = '22px';
  hitMarker.style.height = '22px';
  hitMarker.style.margin = '-11px 0 0 -11px';
  hitMarker.style.opacity = '0';
  hitMarker.style.background = [
    'linear-gradient(45deg, transparent 42%, #ff5d5d 42%, #ff5d5d 58%, transparent 58%)',
    'linear-gradient(-45deg, transparent 42%, #ff5d5d 42%, #ff5d5d 58%, transparent 58%)',
  ].join(',');
  hitMarker.style.filter = 'drop-shadow(0 0 2px rgb(0 0 0 / 80%))';

  /** Red around the edges when this player is hit. Never over the middle. */
  const damage = document.createElement('div');
  damage.style.position = 'absolute';
  damage.style.inset = '0';
  damage.style.opacity = '0';
  damage.style.background =
    'radial-gradient(ellipse at center, transparent 35%, rgb(190 20 20 / 75%) 100%)';

  /**
   * The sight: a circle of glass with everything outside it blacked out.
   *
   * The black comes from a spread shadow rather than from a second element,
   * which is what keeps the edge of the circle exactly the edge of the circle at
   * any size. The two lines cross at the middle, running in from the rim, which
   * is the reticle everybody recognises.
   */
  const scope = document.createElement('div');
  scope.style.position = 'absolute';
  scope.style.inset = '0';
  scope.style.opacity = '0';
  scope.style.pointerEvents = 'none';

  const glass = document.createElement('div');
  glass.style.position = 'absolute';
  glass.style.left = '50%';
  glass.style.top = '50%';
  glass.style.width = 'min(86vmin, 86%)';
  glass.style.aspectRatio = '1';
  glass.style.transform = 'translate(-50%, -50%)';
  glass.style.borderRadius = '50%';
  glass.style.border = '2px solid rgb(0 0 0 / 85%)';
  glass.style.boxShadow = '0 0 0 100vmax #000, inset 0 0 6vmin rgb(0 0 0 / 55%)';

  const across = document.createElement('div');
  across.style.position = 'absolute';
  across.style.left = '0';
  across.style.right = '0';
  across.style.top = '50%';
  across.style.height = '1px';
  across.style.background = 'rgb(0 0 0 / 70%)';

  const down = document.createElement('div');
  down.style.position = 'absolute';
  down.style.top = '0';
  down.style.bottom = '0';
  down.style.left = '50%';
  down.style.width = '1px';
  down.style.background = 'rgb(0 0 0 / 70%)';

  glass.append(across, down);
  scope.appendChild(glass);

  root.append(damage, crosshair, hitMarker, scope, score, message);
  container.appendChild(root);

  // What each element currently says. Writing textContent unconditionally
  // invalidates layout on every frame for text that rarely changes.
  let shownScore = '';
  let shownMessage = '';
  let shownCrosshair = true;
  let shownHit = 0;
  let shownDamage = 0;
  let shownScope = -1;

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
        crosshair.style.display = wantsCrosshair && shownScope <= 0 ? 'block' : 'none';
      }

      // Rounded before comparing, so a value drifting by a thousandth every
      // frame does not rewrite a style sixty times a second for nothing.
      const wantsHit = Math.round(state.hitMarker * 20) / 20;
      if (wantsHit !== shownHit) {
        shownHit = wantsHit;
        hitMarker.style.opacity = String(wantsHit);
      }

      const wantsDamage = Math.round(state.damage * 20) / 20;
      if (wantsDamage !== shownDamage) {
        shownDamage = wantsDamage;
        damage.style.opacity = String(wantsDamage);
      }

      // The sight fades in with the zoom rather than appearing over it, and the
      // crosshair steps aside while it is up: two reticles is one too many.
      const wantsScope = Math.round(state.scope * 20) / 20;
      if (wantsScope !== shownScope) {
        shownScope = wantsScope;
        scope.style.opacity = String(wantsScope);
        scope.style.display = wantsScope > 0 ? 'block' : 'none';
        crosshair.style.display = wantsCrosshair && wantsScope === 0 ? 'block' : 'none';
      }
    },

    destroy(): void {
      root.remove();
    },
  };
}
