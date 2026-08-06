import type { BattleshipView, FleetDraft, MarkedShot, Placement } from '@littlegames/battleship-logic';
import {
  GRID_SIZE,
  ROW_LABELS,
  SHIP_LENGTHS,
  canDrop,
  cellsOf,
  heldLength,
  heldPlacement,
  shipLength,
  shipName,
  waitingShips,
} from '@littlegames/battleship-logic';
import type { GameRenderer } from '@littlegames/core';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { EFFECT_SECONDS, drawEffect, stillFlying, type ShotEffect } from './effects.ts';
import {
  CELL,
  GRID,
  GRID_LEFT,
  GRID_TOP,
  HEADER_Y,
  LAYOUTS,
  TITLE_Y,
  berthAtField,
  cellAtField,
  cellCentre,
  gridCentre,
  layoutFor,
  statusWidthOf,
  type Grid,
  type HitCell,
  type Layout,
} from './layout.ts';
import {
  AIM,
  BACKGROUND,
  FOREGROUND,
  HIT,
  HULL,
  HULL_WRECK,
  ILLEGAL,
  LEGAL,
  LINE,
  MISS,
  MUTED,
  SUNK,
} from './palette.ts';
import { AFLOAT, advanceHull, createHull, drawHull, hullSize, type Hull } from './ships.ts';
import { createWater, type Water } from './water.ts';

const FONT = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

function labelStyle(size: number, colour: number): TextStyle {
  return new TextStyle({ fill: colour, fontFamily: FONT, fontSize: size, fontWeight: '600' });
}

function cellKey(row: number, column: number): string {
  return `${String(row)},${String(column)}`;
}

/** One grid with its caption, its labels, its sea and everything on it. */
interface Board {
  readonly view: Container;
  readonly water: Water;
  /** Only the player's own board carries hulls; the opponent's shows wrecks. */
  readonly hulls: Container;
  readonly marks: Graphics;
  readonly overlay: Graphics;
  readonly caption: Text;
}

function createBoard(title: string, wavePhase: number): Board {
  const view = new Container();

  const caption = new Text({ text: title, style: labelStyle(17, FOREGROUND) });
  caption.position.set(GRID_LEFT, TITLE_Y);
  caption.anchor.set(0, 0.5);

  const water = createWater(wavePhase);
  water.view.position.set(GRID_LEFT, GRID_TOP);

  const hulls = new Container();

  const lines = new Graphics();
  for (let step = 0; step <= GRID_SIZE; step += 1) {
    const offset = step * CELL;
    lines.moveTo(GRID_LEFT + offset, GRID_TOP).lineTo(GRID_LEFT + offset, GRID_TOP + GRID);
    lines.moveTo(GRID_LEFT, GRID_TOP + offset).lineTo(GRID_LEFT + GRID, GRID_TOP + offset);
  }
  lines.stroke({ width: 1, color: LINE, alpha: 0.55 });
  lines.rect(GRID_LEFT, GRID_TOP, GRID, GRID).stroke({ width: 2, color: LINE });

  const labels = new Container();
  for (let index = 0; index < GRID_SIZE; index += 1) {
    const letter = new Text({ text: ROW_LABELS[index] ?? '', style: labelStyle(14, MUTED) });
    letter.anchor.set(0.5);
    letter.position.set(GRID_LEFT / 2, GRID_TOP + index * CELL + CELL / 2);

    const number = new Text({ text: String(index + 1), style: labelStyle(14, MUTED) });
    number.anchor.set(0.5);
    number.position.set(GRID_LEFT + index * CELL + CELL / 2, HEADER_Y);

    labels.addChild(letter, number);
  }

  const marks = new Graphics();
  const overlay = new Graphics();

  view.addChild(caption, labels, water.view, hulls, lines, marks, overlay);
  return { view, water, hulls, marks, overlay, caption };
}

/** Marks one shot on the grid it was fired at. */
function drawMark(target: Graphics, shot: MarkedShot): void {
  const x = GRID_LEFT + shot.column * CELL + CELL / 2;
  const y = GRID_TOP + shot.row * CELL + CELL / 2;

  if (shot.result === 'miss') {
    // Open, pale and small: a miss should read as nothing found, and should
    // never compete with a hit for attention.
    target.circle(x, y, CELL * 0.16).stroke({ width: 2.5, color: MISS, alpha: 0.85 });
    return;
  }

  if (shot.result === 'sunk') {
    // Every cell of a sunk ship comes back marked this way, so a run of them
    // draws the wreck without the client ever being told where the ship was.
    target
      .roundRect(x - CELL * 0.42, y - CELL * 0.42, CELL * 0.84, CELL * 0.84, 4)
      .fill({ color: HULL_WRECK, alpha: 0.9 });
    target
      .moveTo(x - CELL * 0.24, y - CELL * 0.24)
      .lineTo(x + CELL * 0.24, y + CELL * 0.24)
      .moveTo(x + CELL * 0.24, y - CELL * 0.24)
      .lineTo(x - CELL * 0.24, y + CELL * 0.24)
      .stroke({ width: 3, color: SUNK });
    return;
  }

  target.circle(x, y, CELL * 0.28).fill({ color: HIT, alpha: 0.9 });
  target
    .moveTo(x - CELL * 0.2, y - CELL * 0.2)
    .lineTo(x + CELL * 0.2, y + CELL * 0.2)
    .moveTo(x + CELL * 0.2, y - CELL * 0.2)
    .lineTo(x - CELL * 0.2, y + CELL * 0.2)
    .stroke({ width: 3, color: BACKGROUND, alpha: 0.7 });
}

function statusFor(view: BattleshipView): string {
  if (view.finished) {
    return view.youWon ? 'Every ship of theirs is on the bottom. You win.' : 'Your fleet is gone.';
  }
  if (view.phase === 'playing') {
    return view.yourTurn ? 'Your turn. Pick a cell in their waters.' : 'Their turn.';
  }

  const draft = view.draft;
  if (draft === null) {
    // Either the fleet is with the server, or it is confirmed and waiting for
    // an opponent to arrive before it can be.
    return view.opponentPresent
      ? 'Your fleet is set. Waiting for theirs.'
      : 'Your fleet is set. Waiting for an opponent.';
  }

  if (draft.held !== null) {
    return `Drop your ${shipName(draft.held)}. T turns it, Escape puts it back.`;
  }
  const next = waitingShips(draft)[0];
  if (next !== undefined) {
    return `Take your ${shipName(next)} from the tray and drop it on the board.`;
  }
  return 'Your fleet is laid out. Confirm it when you are happy.';
}

/**
 * The renderer, with the two things a canvas cannot do for itself.
 *
 * A canvas has no elements to click, so nothing on it can be a button. `cellAt`
 * and `shipAt` are the whole of the input story: a pointer position divides
 * down to a row and a column, or to one of the ships waiting in the tray. That
 * is cheap, and it is also what this renderer trades away — keyboard play and
 * screen readers came free with elements and do not come free here. Worth doing
 * later as its own piece of work rather than pretended to now.
 */
export interface BattleshipRenderer extends GameRenderer<BattleshipView> {
  /** Which cell a point relative to the canvas falls on, if any. */
  cellAt: (x: number, y: number) => HitCell | null;
  /** Which waiting ship a point falls on, and how far along it, if any. */
  shipAt: (x: number, y: number) => { readonly ship: number; readonly along: number } | null;
  /** How big one cell is on screen right now, in the canvas's own pixels. */
  cellSize: () => number;
}

/**
 * Draws Battleship with PixiJS.
 *
 * This and the files beside it are the only ones in the project allowed to know
 * PixiJS exists. It receives a view and draws it; it holds no rules, no clock
 * of its own that anything depends on, and no network. Animation is played over
 * the state it is given and never in front of it.
 */
export function createBattleshipPixiRenderer(): BattleshipRenderer {
  const app = new Application();
  // Everything is drawn in fixed logical units inside this container, and the
  // container alone is scaled to the screen. Nothing downstream has to know the
  // display size.
  const field = new Container();
  const enemy = createBoard('Their waters', 0);
  const own = createBoard('Your fleet', 2.4);
  const tray = new Graphics();
  const trayLabels = new Container();
  // Above everything, because a torpedo is fired from one board at the other
  // and a ship in hand passes over both.
  const effectLayer = new Graphics();
  const inHand = new Graphics();
  const status = new Text({ text: '', style: labelStyle(16, FOREGROUND) });

  let mounted = false;
  let layout: Layout = LAYOUTS.PLAY_TALL;
  let placing = false;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  const startedAt = performance.now();
  let lastSeconds = 0;

  let hulls: Hull[] = [];
  /** What the hulls currently show, so five ships are not rebuilt per frame. */
  let drawnFleet = '';
  /** What the shot marks currently show, for the same reason. */
  let drawnMarks = '';
  /** What the tray currently shows. */
  let drawnTray = '';
  let drawnStatus = '';

  // The shots this renderer last saw. An effect is started for a shot that was
  // not here a frame ago — never for a snapshot that arrives carrying a dozen,
  // which is what a player rejoining a game in progress receives.
  let seenIncoming = 0;
  let seenOutgoing = 0;
  // Whether the previous frame was already a game in progress. The first one
  // that is only establishes the count to compare against: a player who walks
  // back into a match under way must not be shown a torpedo for a shot that was
  // fired while they were gone.
  let wasInPlay = false;
  const effects: ShotEffect[] = [];

  /** Places the boards and the tray, and fits the field into its box. */
  function reflow(): void {
    const wanted = layoutFor(lastWidth, lastHeight, placing);
    if (wanted !== layout) {
      layout = wanted;
      // Anything in the air was aimed at cells that have just moved.
      effects.length = 0;
      drawnTray = '';
    }

    enemy.view.visible = layout.enemy !== null;
    if (layout.enemy !== null) {
      enemy.view.position.set(layout.enemy.x, layout.enemy.y);
    }
    own.view.position.set(layout.own.x, layout.own.y);
    status.position.set(layout.width / 2, layout.statusY);

    if (lastWidth <= 0 || lastHeight <= 0) {
      return;
    }
    // Letterboxed rather than stretched: a squashed grid would stop being
    // square, and a cell that is not square is a cell that is hard to aim at.
    scale = Math.min(lastWidth / layout.width, lastHeight / layout.height);
    offsetX = (lastWidth - layout.width * scale) / 2;
    offsetY = (lastHeight - layout.height * scale) / 2;
    field.scale.set(scale);
    field.position.set(offsetX, offsetY);
  }

  /** A point on the canvas, in field units. */
  function toField(x: number, y: number): { x: number; y: number } {
    return { x: (x - offsetX) / scale, y: (y - offsetY) / scale };
  }

  /** Rebuilds the hulls when the fleet they draw is no longer the fleet. */
  function syncFleet(fleet: readonly (Placement | null)[], incoming: readonly MarkedShot[]): void {
    const wanted = fleet
      .map((ship) =>
        ship === null ? '-' : `${String(ship.row)}${String(ship.column)}${ship.orientation}`,
      )
      .join('|');

    if (wanted !== drawnFleet) {
      drawnFleet = wanted;
      own.hulls.removeChildren();
      for (const hull of hulls) {
        hull.view.destroy({ children: true });
      }
      hulls = [];
      for (const [index, ship] of fleet.entries()) {
        if (ship === null) {
          continue;
        }
        const hull = createHull(ship, shipLength(index));
        hulls.push(hull);
        own.hulls.addChild(hull.view);
      }
    }

    if (hulls.length === 0) {
      return;
    }

    const struck = new Set(incoming.map((shot) => cellKey(shot.row, shot.column)));
    let hullIndex = 0;
    for (const [index, ship] of fleet.entries()) {
      if (ship === null) {
        continue;
      }
      const hull = hulls[hullIndex];
      hullIndex += 1;
      if (hull === undefined || hull.sinking !== null) {
        continue;
      }
      const gone = cellsOf(ship, shipLength(index)).every((cell) =>
        struck.has(cellKey(cell.row, cell.column)),
      );
      if (gone) {
        hull.sinking = 0;
      }
    }
  }

  /** Starts a torpedo for a shot that has just appeared. */
  function noticeShots(
    shots: readonly MarkedShot[],
    seen: number,
    animate: boolean,
    firedFrom: Grid,
    landsOn: Grid,
  ): number {
    const latest = shots.at(-1);
    // Exactly one more than last frame: that is a shot somebody just took. Any
    // other jump is a board arriving in bulk, which is what a reconnection
    // brings, and none of it is news worth an explosion.
    if (animate && shots.length === seen + 1 && latest !== undefined) {
      effects.push({
        from: gridCentre(layout, firedFrom),
        to: cellCentre(layout, landsOn, latest.row, latest.column),
        result: latest.result,
        cell: `${landsOn}:${cellKey(latest.row, latest.column)}`,
        elapsed: 0,
      });
    }
    return shots.length;
  }

  /** Redraws both sets of shot marks, hiding those a torpedo has not reached. */
  function syncMarks(view: BattleshipView, hidden: ReadonlySet<string>): void {
    const wanted = [
      view.incoming.length,
      view.yourShipsSunk,
      view.outgoing.length,
      view.opponentShipsSunk,
      [...hidden].toSorted().join(),
    ].join('/');
    if (wanted === drawnMarks) {
      return;
    }
    drawnMarks = wanted;

    enemy.marks.clear();
    for (const shot of view.outgoing) {
      if (!hidden.has(`enemy:${cellKey(shot.row, shot.column)}`)) {
        drawMark(enemy.marks, shot);
      }
    }

    own.marks.clear();
    for (const shot of view.incoming) {
      if (!hidden.has(`own:${cellKey(shot.row, shot.column)}`)) {
        drawMark(own.marks, shot);
      }
    }
  }

  /** Redraws the ships still waiting to be placed. */
  function syncTray(draft: FleetDraft | null): void {
    const berths = layout.tray;
    const waiting = draft === null || berths === null ? [] : waitingShips(draft);
    const wanted = `${layout.key}:${waiting.join(',')}`;
    if (wanted === drawnTray) {
      return;
    }
    drawnTray = wanted;

    tray.clear();
    trayLabels.removeChildren();
    if (berths === null) {
      return;
    }

    for (const [index, berth] of berths.entries()) {
      // The berth an empty-handed ship left behind stays outlined, so the tray
      // keeps its shape as it empties and a ship put back has somewhere to go.
      tray
        .roundRect(berth.x - 4, berth.y - 4, berth.width + 8, CELL + 8, 8)
        .stroke({ width: 1.5, color: LINE, alpha: waiting.includes(index) ? 0.8 : 0.3 });

      const name = new Text({
        text: `${shipName(index)} · ${String(shipLength(index))}`,
        style: labelStyle(12, waiting.includes(index) ? MUTED : LINE),
      });
      name.anchor.set(0.5, 0);
      name.position.set(berth.x + berth.width / 2, berth.y + CELL + 6);
      trayLabels.addChild(name);

      if (waiting.includes(index)) {
        drawHull(tray, berth.x, berth.y, shipLength(index), 'horizontal', AFLOAT);
      }
    }
  }

  /** The ship in hand, and where it would land. */
  function drawInHand(view: BattleshipView): void {
    inHand.clear();
    own.overlay.clear();

    const draft = view.draft;
    const at = view.pointer;
    if (draft === null || draft.held === null || at === null) {
      return;
    }

    const length = heldLength(draft);
    const point = toField(at.x, at.y);
    const cell = cellAtField(layout, point.x, point.y);

    if (cell !== null && cell.grid === 'own') {
      // Over the board it snaps to the grid: a ship that lands where it was
      // shown is worth more than one that follows the pointer to the pixel.
      // Drawn into the board's own overlay, so it sits under the grid lines
      // and reads as being on the water rather than over it.
      const placement = heldPlacement(draft, cell.row, cell.column);
      if (placement !== null) {
        // Refused under the cursor rather than after a round trip: this is the
        // reason the rules exist in TypeScript as well as in Go.
        const legal = canDrop(draft, cell.row, cell.column);
        drawHull(
          own.overlay,
          GRID_LEFT + placement.column * CELL,
          GRID_TOP + placement.row * CELL,
          length,
          placement.orientation,
          { body: legal ? LEGAL : ILLEGAL, outline: LINE, alpha: 0.85 },
        );
      }
      return;
    }

    // Off the board it simply follows the pointer, carried by the cell it was
    // taken hold of by.
    const { width, height } = hullSize(length, draft.orientation);
    const grabbed = draft.grabbedAt * CELL + CELL / 2;
    const x = point.x - (draft.orientation === 'horizontal' ? grabbed : width / 2);
    const y = point.y - (draft.orientation === 'horizontal' ? height / 2 : grabbed);
    drawHull(inHand, x, y, length, draft.orientation, { body: HULL, outline: LINE, alpha: 0.8 });
  }

  /** The cell under the pointer while there is a shot to take. */
  function drawAim(view: BattleshipView): void {
    enemy.overlay.clear();
    if (view.phase !== 'playing' || !view.yourTurn || view.pointer === null) {
      return;
    }
    const point = toField(view.pointer.x, view.pointer.y);
    const at = cellAtField(layout, point.x, point.y);
    if (at === null || at.grid !== 'enemy') {
      return;
    }

    const spent = view.outgoing.some((shot) => shot.row === at.row && shot.column === at.column);
    const x = GRID_LEFT + at.column * CELL;
    const y = GRID_TOP + at.row * CELL;
    enemy.overlay.rect(x + 2, y + 2, CELL - 4, CELL - 4);
    enemy.overlay.stroke({ width: 2.5, color: spent ? MUTED : AIM, alpha: spent ? 0.5 : 1 });
    if (!spent) {
      enemy.overlay
        .moveTo(x + CELL / 2, y + 6)
        .lineTo(x + CELL / 2, y + CELL - 6)
        .moveTo(x + 6, y + CELL / 2)
        .lineTo(x + CELL - 6, y + CELL / 2)
        .stroke({ width: 1.5, color: AIM, alpha: 0.55 });
    }
  }

  function drawCaptions(view: BattleshipView): void {
    const fleet = String(SHIP_LENGTHS.length);
    const theirs = `Their waters — ${String(view.opponentShipsSunk)}/${fleet} sunk`;
    if (enemy.caption.text !== theirs) {
      enemy.caption.text = theirs;
    }
    const mine = placing
      ? 'Your fleet — drop your ships here'
      : `Your fleet — ${String(view.yourShipsSunk)}/${fleet} lost`;
    if (own.caption.text !== mine) {
      own.caption.text = mine;
    }

    const wanted = `${layout.key}:${statusFor(view)}`;
    if (wanted !== drawnStatus) {
      // Assigning the same string still costs a text measurement.
      drawnStatus = wanted;
      status.text = statusFor(view);
      // A sentence that does not fit is shrunk until it does, rather than
      // written shorter: the narrow layout is a telephone, the sentences are
      // the ones a beginner needs most, and a line clipped at both ends is
      // worse than a small one.
      status.scale.set(1);
      const room = statusWidthOf(layout);
      if (status.width > room) {
        status.scale.set(room / status.width);
      }
    }
  }

  return {
    mount(container: HTMLElement): Promise<void> {
      // PixiJS 8 does not build a renderer in the constructor: without this
      // await there is no canvas and no GPU context at all.
      return app
        .init({
          background: BACKGROUND,
          antialias: true,
          // Matching the device pixel ratio keeps edges crisp on phones and
          // high-density laptops. Capped at 2: beyond that the backing store
          // grows quadratically for a difference nobody can see.
          resolution: Math.min(globalThis.devicePixelRatio, 2),
          autoDensity: true,
          width: layout.width,
          height: layout.height,
          // The game loop drives drawing. Left on, PixiJS would also render on
          // its own ticker, drawing states nobody asked for.
          autoStart: false,
        })
        .then(() => {
          status.anchor.set(0.5);
          reflow();
          field.addChild(enemy.view, own.view, tray, trayLabels, effectLayer, inHand, status);
          app.stage.addChild(field);
          container.append(app.canvas);
          mounted = true;
          return undefined;
        });
    },

    render(view: BattleshipView): void {
      if (!mounted) {
        return;
      }

      // Laying a fleet out and playing the game want different pictures. The
      // box on the page does not change, so nothing reflows; the field inside
      // it does, and the boards simply get more room while there is a fleet to
      // arrange.
      const wantsTray = view.draft !== null;
      if (wantsTray !== placing) {
        placing = wantsTray;
        reflow();
      }

      const seconds = (performance.now() - startedAt) / 1000;
      // Clamped, because a tab that was in the background comes back with a
      // gap of minutes in it, and nothing on screen should cross the board in
      // one frame to catch up.
      const delta = Math.min(Math.max(seconds - lastSeconds, 0), 0.1);
      lastSeconds = seconds;

      enemy.water.update(seconds);
      own.water.update(seconds);

      // While the fleet is being laid out the server knows nothing about it, so
      // the ships on screen are the draft's. Once confirmed they are the
      // server's copy, which is the one that can be sunk.
      syncFleet(view.draft === null ? view.yourFleet : view.draft.slots, view.incoming);

      // A game that has just ended still counts as in play: the shot that ended
      // it arrives in the same snapshot as the result, and it is the one
      // explosion nobody should miss.
      const inPlay = view.phase === 'playing' || view.phase === 'finished';
      seenOutgoing = noticeShots(view.outgoing, seenOutgoing, wasInPlay, 'own', 'enemy');
      seenIncoming = noticeShots(view.incoming, seenIncoming, wasInPlay, 'enemy', 'own');
      wasInPlay = inPlay;

      effectLayer.clear();
      const hidden = new Set<string>();
      for (let index = effects.length - 1; index >= 0; index -= 1) {
        const effect = effects[index];
        if (effect === undefined) {
          continue;
        }
        effect.elapsed += delta;
        if (effect.elapsed >= EFFECT_SECONDS) {
          effects.splice(index, 1);
          continue;
        }
        if (stillFlying(effect)) {
          hidden.add(effect.cell);
        }
        drawEffect(effectLayer, effect);
      }

      syncMarks(view, hidden);
      syncTray(view.draft);
      for (const hull of hulls) {
        advanceHull(hull, delta);
      }
      drawInHand(view);
      drawAim(view);
      drawCaptions(view);

      app.renderer.render(app.stage);
    },

    resize(width: number, height: number): void {
      if (!mounted) {
        return;
      }
      // A collapsed or unchanged box is not worth reallocating a drawing
      // surface for, and refusing to act on one is also what stops a resize
      // from feeding itself.
      if (width <= 0 || height <= 0 || (width === lastWidth && height === lastHeight)) {
        return;
      }
      lastWidth = width;
      lastHeight = height;
      app.renderer.resize(width, height);
      reflow();
    },

    cellAt(x: number, y: number): HitCell | null {
      if (!mounted || scale <= 0) {
        return null;
      }
      const point = toField(x, y);
      return cellAtField(layout, point.x, point.y);
    },

    shipAt(x: number, y: number) {
      if (!mounted || scale <= 0) {
        return null;
      }
      const point = toField(x, y);
      return berthAtField(layout, point.x, point.y);
    },

    cellSize(): number {
      return CELL * scale;
    },

    destroy(): void {
      if (!mounted) {
        return;
      }
      mounted = false;
      hulls = [];
      drawnFleet = '';
      drawnMarks = '';
      drawnTray = '';
      drawnStatus = '';
      seenIncoming = 0;
      seenOutgoing = 0;
      wasInPlay = false;
      placing = false;
      effects.length = 0;
      lastWidth = 0;
      lastHeight = 0;
      // Releasing the GPU context matters on mobile, where a leaked one can
      // cost the next match its renderer entirely.
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
