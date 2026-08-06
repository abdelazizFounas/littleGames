import type { Graphics } from 'pixi.js';
import type { Point } from './layout.ts';
import { CELL } from './layout.ts';
import { HIT, HULL_WRECK, MISS, SEA_WAVE_HIGH, SUNK } from './palette.ts';

/**
 * The torpedo, the splash and the explosion.
 *
 * None of this is the truth of the game. A shot is resolved by the server the
 * instant it is fired; what happens here is a picture played over a state that
 * has already moved on, never a delay in front of it. The renderer starts one
 * of these when it notices a shot that was not on the board last frame, and the
 * board underneath is correct throughout — which is also why a player who
 * reconnects into a game in progress does not sit through every explosion that
 * happened while they were away.
 */

/** How long the torpedo is in the air. */
const FLIGHT_SECONDS = 0.5;

/** How long the splash or the fireball lasts after it lands. */
const BURST_SECONDS = 0.7;

export const EFFECT_SECONDS = FLIGHT_SECONDS + BURST_SECONDS;

export interface ShotEffect {
  readonly from: Point;
  readonly to: Point;
  readonly result: 'miss' | 'hit' | 'sunk';
  /** Which cell this is about, so its mark can wait until the shot lands. */
  readonly cell: string;
  /** Seconds since it was fired. */
  elapsed: number;
}

/** Where the torpedo is at a given point of its flight. */
function alongFlight(effect: ShotEffect, progress: number): Point {
  const straightX = effect.from.x + (effect.to.x - effect.from.x) * progress;
  const straightY = effect.from.y + (effect.to.y - effect.from.y) * progress;
  const span = Math.hypot(effect.to.x - effect.from.x, effect.to.y - effect.from.y);
  // Lifted into an arc, so it reads as something thrown across the water
  // rather than dragged along a ruler.
  return { x: straightX, y: straightY - Math.sin(Math.PI * progress) * span * 0.08 };
}

function drawTorpedo(target: Graphics, effect: ShotEffect, progress: number): void {
  const head = alongFlight(effect, progress);
  const tail = alongFlight(effect, Math.max(progress - 0.04, 0));
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;

  // A wake of fading dots behind it. Cheaper than a trail of geometry, and it
  // says which way the thing is going better than the body alone does.
  for (let back = 1; back <= 5; back += 1) {
    const point = alongFlight(effect, Math.max(progress - back * 0.06, 0));
    target
      .circle(point.x, point.y, 3 - back * 0.4)
      .fill({ color: SEA_WAVE_HIGH, alpha: 0.4 - back * 0.06 });
  }

  target
    .poly([
      head.x + ux * 7,
      head.y + uy * 7,
      head.x - uy * 3,
      head.y + ux * 3,
      head.x - ux * 8,
      head.y - uy * 8,
      head.x + uy * 3,
      head.y - ux * 3,
    ])
    .fill(0xf6f8fb);
}

function drawSplash(target: Graphics, at: Point, progress: number): void {
  const fade = 1 - progress;
  target
    .circle(at.x, at.y, 4 + progress * CELL * 0.7)
    .stroke({ width: 3 * fade, color: MISS, alpha: 0.9 * fade });

  for (let droplet = 0; droplet < 6; droplet += 1) {
    const angle = (droplet / 6) * Math.PI * 2;
    const distance = progress * CELL * 0.55;
    target
      .circle(at.x + Math.cos(angle) * distance, at.y + Math.sin(angle) * distance, 2.5 * fade)
      .fill({ color: MISS, alpha: 0.8 * fade });
  }
}

function drawFireball(target: Graphics, at: Point, progress: number, sinking: boolean): void {
  const fade = 1 - progress;
  const reach = sinking ? CELL * 1.1 : CELL * 0.75;

  target
    .circle(at.x, at.y, reach * progress)
    .stroke({ width: 4 * fade, color: sinking ? SUNK : HIT, alpha: fade });
  target.circle(at.x, at.y, CELL * 0.42 * fade).fill({ color: HIT, alpha: 0.85 * fade });

  const spikes = sinking ? 10 : 7;
  for (let spike = 0; spike < spikes; spike += 1) {
    const angle = (spike / spikes) * Math.PI * 2 + progress;
    const distance = reach * progress * 0.8;
    target
      .circle(at.x + Math.cos(angle) * distance, at.y + Math.sin(angle) * distance, 4 * fade)
      .fill({ color: sinking ? SUNK : HIT, alpha: fade });
  }

  if (sinking) {
    // Smoke, drifting up off a ship that is going down.
    target
      .circle(at.x, at.y - progress * CELL * 0.9, CELL * 0.5 * progress)
      .fill({ color: HULL_WRECK, alpha: 0.35 * fade });
  }
}

/** Draws one effect at whatever moment of its life it has reached. */
export function drawEffect(target: Graphics, effect: ShotEffect): void {
  if (effect.elapsed < FLIGHT_SECONDS) {
    const progress = effect.elapsed / FLIGHT_SECONDS;
    drawTorpedo(target, effect, progress);
    return;
  }

  const progress = Math.min((effect.elapsed - FLIGHT_SECONDS) / BURST_SECONDS, 1);
  if (effect.result === 'miss') {
    drawSplash(target, effect.to, progress);
    return;
  }
  drawFireball(target, effect.to, progress, effect.result === 'sunk');
}

/** True while the cell's own mark should stay hidden behind the effect. */
export function stillFlying(effect: ShotEffect): boolean {
  return effect.elapsed < FLIGHT_SECONDS;
}
