import type {
  BattleshipView,
  FleetDraft,
  MarkedShot,
  Placement,
  ShotResult,
} from '@littlegames/battleship-logic';
import {
  alreadyFired,
  canDrop,
  clearDraft,
  createDraft,
  draftFleet,
  dropShip,
  offsetAlong,
  placedCount,
  returnHeld,
  rotateDraft,
  shipAtCell,
  shuffleDraft,
  takeShip,
} from '@littlegames/battleship-logic';
import {
  BattleshipOrientation,
  BattleshipPhase,
  BattleshipShotResult,
  type BattleshipSnapshot,
} from '@littlegames/core';
import type { BattleshipConnection, BattleshipMatchListeners } from '@littlegames/net';

/** What the screen around the canvas needs to know, and nothing more. */
export type BattleshipStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'waiting' }
  | {
      readonly kind: 'placement';
      /** True once the server holds this fleet and it can no longer be moved. */
      readonly ready: boolean;
      /**
       * True when the fleet has been confirmed but the game is not yet ready
       * for it, because nobody else has arrived. It goes the moment they do.
       */
      readonly queued: boolean;
      readonly placed: number;
      readonly holding: boolean;
      readonly complete: boolean;
      readonly opponentPresent: boolean;
    }
  | { readonly kind: 'playing'; readonly yourTurn: boolean }
  | { readonly kind: 'finished'; readonly won: boolean }
  | { readonly kind: 'reconnecting' }
  | { readonly kind: 'failed'; readonly message: string };

/** The controls a screen can offer while a fleet is being laid out. */
export interface BattleshipSession {
  /** Turns the ship in hand a quarter turn. */
  rotate: () => void;
  /** Deals a fresh legal arrangement. */
  shuffle: () => void;
  /** Empties the board and puts every ship back in the tray. */
  clear: () => void;
  /** Sends the fleet to the server, which checks it again before believing it. */
  confirm: () => void;
  stop: () => void;
}

const PHASES: Record<number, BattleshipView['phase']> = {
  [BattleshipPhase.PHASE_WAITING]: 'waiting',
  [BattleshipPhase.PHASE_PLACEMENT]: 'placement',
  [BattleshipPhase.PHASE_PLAYING]: 'playing',
  [BattleshipPhase.PHASE_FINISHED]: 'finished',
};

const RESULTS: Record<number, ShotResult> = {
  [BattleshipShotResult.SHOT_RESULT_MISS]: 'miss',
  [BattleshipShotResult.SHOT_RESULT_HIT]: 'hit',
  [BattleshipShotResult.SHOT_RESULT_SUNK]: 'sunk',
};

/**
 * How far a pointer must travel before a press counts as a drag.
 *
 * Below it, picking a ship up and letting go in place leaves the ship in hand,
 * waiting for a second tap to say where it goes. That is the same gesture a
 * finger makes on a telephone, where there is no hovering and no dragging
 * something you cannot see under your own thumb.
 */
const DRAG_THRESHOLD_PX = 8;

/**
 * How far above a finger the ship being carried is drawn, in cells.
 *
 * A thumb covers about a centimetre of screen, which is most of a cell. Held
 * exactly under it, the ship and the square it is going onto are both hidden by
 * the hand placing them.
 */
const TOUCH_LIFT_CELLS = 1.4;

function toShots(shots: BattleshipSnapshot['incoming']): MarkedShot[] {
  return shots.map((shot) => ({
    row: shot.row,
    column: shot.column,
    result: RESULTS[shot.result] ?? 'miss',
  }));
}

function toFleet(fleet: BattleshipSnapshot['yourFleet']): Placement[] {
  return fleet.map((ship) => ({
    row: ship.row,
    column: ship.column,
    orientation:
      ship.orientation === BattleshipOrientation.ORIENTATION_VERTICAL ? 'vertical' : 'horizontal',
  }));
}

/** The board before the server has said anything about it. */
function emptyView(): BattleshipView {
  return {
    phase: 'waiting',
    yourTurn: false,
    yourFleet: [],
    incoming: [],
    outgoing: [],
    youAreReady: false,
    opponentReady: false,
    opponentPresent: false,
    yourShipsSunk: 0,
    opponentShipsSunk: 0,
    finished: false,
    youWon: false,
    draft: null,
    pointer: null,
  };
}

/** Rebuilds the client's view of the game from a wire snapshot. */
function toView(snapshot: BattleshipSnapshot): BattleshipView {
  return {
    phase: PHASES[snapshot.phase] ?? 'waiting',
    yourTurn: snapshot.yourTurn,
    yourFleet: toFleet(snapshot.yourFleet),
    incoming: toShots(snapshot.incoming),
    outgoing: toShots(snapshot.outgoing),
    youAreReady: snapshot.youAreReady,
    opponentReady: snapshot.opponentReady,
    opponentPresent: snapshot.opponentPresent,
    yourShipsSunk: snapshot.yourShipsSunk,
    opponentShipsSunk: snapshot.opponentShipsSunk,
    finished: snapshot.finished,
    youWon: snapshot.youWon,
    draft: null,
    pointer: null,
  };
}

function statusOf(view: BattleshipView, draft: FleetDraft, queued: boolean): BattleshipStatus {
  if (view.finished) {
    return { kind: 'finished', won: view.youWon };
  }
  switch (view.phase) {
    // An empty lobby is the best moment there is to lay a fleet out: there is
    // nothing else to do, and doing it now means the game starts the instant
    // somebody arrives rather than a minute after.
    case 'waiting':
    case 'placement': {
      return {
        kind: 'placement',
        ready: view.youAreReady,
        queued,
        placed: placedCount(draft),
        holding: draft.held !== null,
        complete: draftFleet(draft) !== null,
        opponentPresent: view.opponentPresent,
      };
    }
    case 'playing': {
      return { kind: 'playing', yourTurn: view.yourTurn };
    }
    default: {
      return { kind: 'waiting' };
    }
  }
}

/** Two statuses are the same report when every field of them matches. */
function sameStatus(left: BattleshipStatus | null, right: BattleshipStatus): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Runs a game of Battleship: pointer, placement, firing and drawing.
 *
 * Deliberately plain TypeScript with its own animation frame loop, exactly as
 * Pong is. Nothing about the match changes between turns, but the water does,
 * sixty times a second — so a turn-based game turns out to need a render loop
 * after all, and React must stay as far outside it as it does for a ball.
 *
 * The loop reports back only on events worth a re-render: joining, a phase
 * changing, a turn passing, a ship picked up or put down, a refusal to show.
 */
export async function startBattleshipSession(
  container: HTMLElement,
  matchId: string,
  password: string,
  joinMatch: (
    listeners: BattleshipMatchListeners,
    matchId: string,
    password?: string,
  ) => Promise<BattleshipConnection>,
  onStatus: (status: BattleshipStatus) => void,
  onJoined: (matchId: string) => void,
  onNotice: (reason: string) => void,
  signal: AbortSignal,
): Promise<BattleshipSession> {
  // Loaded only now, so the catalogue and the lobby never carry a rendering
  // engine they have no use for.
  const { createBattleshipPixiRenderer } = await import('@littlegames/battleship-renderer-pixi');
  const renderer = createBattleshipPixiRenderer();

  let authoritative = emptyView();
  let draft = createDraft();
  let pointer: { x: number; y: number } | null = null;
  /** The cell a finger has aimed at but not yet committed to firing on. */
  let armed: string | null = null;
  /** Where a press began, so a drag can be told from a tap. */
  let pressedAt: { x: number; y: number } | null = null;
  let dragged = false;
  /** Whether the hand on the screen is a finger rather than a mouse. */
  let touching = false;
  let reported: BattleshipStatus | null = null;
  let running = true;
  let frame = 0;
  /** The fleet has been confirmed, but the game was not yet ready to take it. */
  let queued = false;
  /** It has now gone; without this the next tick would send it a second time. */
  let sending = false;

  const arranging = (): boolean =>
    !authoritative.youAreReady &&
    !queued &&
    (authoritative.phase === 'waiting' || authoritative.phase === 'placement');

  const report = (): void => {
    const status = statusOf(authoritative, draft, queued);
    if (!sameStatus(reported, status)) {
      reported = status;
      onStatus(status);
    }
  };

  /** Everything the renderer draws: the server's half, and this screen's half. */
  const compose = (): BattleshipView => {
    const confirmed = queued ? draftFleet(draft) : null;
    return {
      ...authoritative,
      // While a confirmed fleet is waiting for the game to be ready for it, the
      // server has no copy to draw, so this one stands in. It is replaced by the
      // server's the moment there is one, and it is the same arrangement — the
      // client checked it against the same rules before offering it.
      yourFleet:
        confirmed !== null && authoritative.yourFleet.length === 0
          ? confirmed
          : authoritative.yourFleet,
      draft: arranging() ? draft : null,
      pointer,
    };
  };

  const resizeToContainer = (): void => {
    renderer.resize(container.clientWidth, container.clientHeight);
  };

  await renderer.mount(container);
  resizeToContainer();
  // One frame before anything has arrived from the server. Without it the
  // canvas stays blank until the first snapshot, which reads as the game
  // having failed rather than as it being about to start.
  renderer.render(compose(), 0);
  // Watching the element rather than the window catches every reason it can
  // change size — entering fullscreen, rotating a phone, the layout reflowing —
  // with one listener instead of one per cause.
  const resizeObserver = new ResizeObserver(resizeToContainer);
  resizeObserver.observe(container);

  // Loading the engine takes long enough for the screen to have been left, or
  // for a development double-mount to have discarded this session already.
  if (signal.aborted) {
    resizeObserver.disconnect();
    renderer.destroy();
    throw new Error('The match was left before it started.');
  }

  let connection: BattleshipConnection;
  try {
    connection = await joinMatch(
      {
        onSnapshot: (snapshot) => {
          // Once the server has taken the fleet it holds the only copy that
          // matters, and `compose` stops showing the draft — so there are never
          // two arrangements on screen that could disagree.
          authoritative = toView(snapshot);
          flush();
          report();
        },
        onRefused: (reason) => {
          // A fleet the server would not take goes back to being a fleet the
          // player is arranging, rather than one that sits there confirmed and
          // never arrives.
          if (queued && !authoritative.youAreReady) {
            queued = false;
            sending = false;
            report();
          }
          onNotice(reason);
        },
        onConnectionChange: (link) => {
          if (link === 'reconnecting') {
            reported = { kind: 'reconnecting' };
            onStatus({ kind: 'reconnecting' });
            return;
          }
          if (link === 'lost') {
            reported = { kind: 'failed', message: 'The connection to the match was lost.' };
            onStatus(reported);
            return;
          }
          // Back on a new socket. The next snapshot carries the whole board, so
          // there is nothing to discard here — but a shot aimed before the drop
          // should not fire itself now, and a fleet sent into a socket that
          // then dropped may never have arrived, so it is offered again.
          armed = null;
          sending = false;
          reported = null;
          report();
        },
        onError: () => {
          const failed: BattleshipStatus = {
            kind: 'failed',
            message: 'The match connection ran into an error.',
          };
          reported = failed;
          onStatus(failed);
        },
      },
      matchId,
      password,
    );
  } catch (cause) {
    resizeObserver.disconnect();
    renderer.destroy();
    throw cause;
  }

  onJoined(connection.matchId);

  /** Where a pointer event lands on the canvas. */
  const locate = (event: PointerEvent): { x: number; y: number } => {
    const bounds = container.getBoundingClientRect();
    touching = event.pointerType === 'touch';
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  /**
   * Where a ship being dragged by a finger is carried, and therefore dropped.
   *
   * Lifted clear of the hand, because a thumb covers most of a cell and hides
   * both the ship and the square it is going onto. Applied to the carrying and
   * to the letting go, and to nothing else: what a press *selects* is whatever
   * is genuinely under it, or every tap would land a cell and a half from the
   * thing it was aimed at. A tap that never became a drag is a tap, and lands
   * exactly where it was made.
   */
  const carried = (at: { x: number; y: number }): { x: number; y: number } =>
    touching && dragged && draft.held !== null
      ? { x: at.x, y: at.y - renderer.cellSize() * TOUCH_LIFT_CELLS }
      : at;

  const turn = (): void => {
    if (arranging()) {
      draft = rotateDraft(draft);
    }
  };

  /** Takes a ship in hand, from the tray or back off the board. */
  const grab = (at: { x: number; y: number }): boolean => {
    const berth = renderer.shipAt(at.x, at.y);
    if (berth !== null) {
      draft = takeShip(draft, berth.ship, berth.along);
      return true;
    }

    const cell = renderer.cellAt(at.x, at.y);
    if (cell === null || cell.grid !== 'own') {
      return false;
    }
    const ship = shipAtCell(draft, cell.row, cell.column);
    if (ship === null) {
      return false;
    }
    // Picked back up by the cell that was touched, so it can be nudged one
    // square along without first working out where its stern is.
    const placement = draft.slots[ship];
    const along = placement === undefined || placement === null
      ? 0
      : offsetAlong(placement, cell.row, cell.column);
    draft = { ...takeShip(draft, ship, along), orientation: placement?.orientation ?? draft.orientation };
    return true;
  };

  /** Lets the held ship go, if the pointer is over somewhere it may go. */
  const release = (at: { x: number; y: number }): boolean => {
    const cell = renderer.cellAt(at.x, at.y);
    if (cell === null || cell.grid !== 'own' || !canDrop(draft, cell.row, cell.column)) {
      return false;
    }
    draft = dropShip(draft, cell.row, cell.column);
    return true;
  };

  const fireAt = (row: number, column: number): void => {
    if (!authoritative.yourTurn || alreadyFired(authoritative.outgoing, row, column)) {
      return;
    }
    void connection.fire(row, column);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const at = locate(event);
    if (pressedAt !== null && !dragged) {
      dragged = Math.hypot(at.x - pressedAt.x, at.y - pressedAt.y) > DRAG_THRESHOLD_PX;
    }
    // Drawn where it would be dropped, so the picture and the outcome are the
    // same arithmetic.
    pointer = carried(at);
  };

  const onPointerLeave = (): void => {
    pointer = null;
    pressedAt = null;
    dragged = false;
  };

  const onPointerDown = (event: PointerEvent): void => {
    const at = locate(event);
    pressedAt = at;
    dragged = false;
    pointer = at;

    if (arranging()) {
      // A ship already in hand is looking for somewhere to land, and this press
      // is where. Only if it cannot land here does the press mean anything
      // else.
      if (draft.held !== null) {
        if (release(at)) {
          report();
        }
        return;
      }
      if (grab(at)) {
        // Capture, so a ship dragged off the canvas stays in hand rather than
        // being dropped by an event that never comes back.
        container.setPointerCapture(event.pointerId);
        report();
      }
      return;
    }

    if (authoritative.phase !== 'playing') {
      return;
    }
    const cell = renderer.cellAt(at.x, at.y);
    if (cell === null || cell.grid !== 'enemy') {
      return;
    }

    // A finger has no hover, so a single tap would both aim and fire and a
    // misplaced thumb would spend the turn. One tap aims, and a second on the
    // same cell commits. A mouse has already shown its aim on the way there.
    const key = `${String(cell.row)},${String(cell.column)}`;
    if (event.pointerType === 'touch' && armed !== key) {
      armed = key;
      return;
    }
    armed = null;
    fireAt(cell.row, cell.column);
  };

  const onPointerUp = (event: PointerEvent): void => {
    const at = carried(locate(event));
    pointer = at;
    const wasDragged = dragged;

    if (container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }

    // A real drag ends where it is let go. A press that never moved is a tap:
    // the ship stays in hand and waits to be told where to go, which is the
    // only gesture that works with a finger.
    if (arranging() && draft.held !== null && wasDragged && release(at)) {
      report();
    }
    pressedAt = null;
    dragged = false;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // The invitation code sits on the same screen, in a field a player can be
    // typing into. A letter meant for it must not turn a ship.
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      return;
    }
    if (!arranging()) {
      return;
    }

    // T is the one asked for; R is what every other game with a placement
    // screen uses, and costs nothing to accept as well.
    if (event.key === 't' || event.key === 'T' || event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      turn();
      return;
    }
    if (event.key === 'Escape' && draft.held !== null) {
      draft = returnHeld(draft);
      report();
      return;
    }
    if (event.key === 'Enter' && draftFleet(draft) !== null) {
      event.preventDefault();
      send();
    }
  };

  // Right-clicking to turn a ship is what every game with a placement screen
  // does, so the menu is suppressed over the board and the click turns it.
  const onContextMenu = (event: MouseEvent): void => {
    if (arranging()) {
      event.preventDefault();
      turn();
    }
  };

  /**
   * Sends the confirmed fleet, once the game is somewhere it can be sent.
   *
   * A lobby with nobody else in it has not opened placement yet, so a fleet
   * confirmed there waits here until it has. Sent once, and not again on the
   * next tick — the server answers a second copy with a refusal the player has
   * done nothing to deserve.
   */
  const flush = (): void => {
    const fleet = queued && !sending ? draftFleet(draft) : null;
    if (fleet === null || authoritative.phase !== 'placement' || authoritative.youAreReady) {
      return;
    }
    sending = true;
    void connection.placeFleet(
      fleet.map((ship) => ({
        row: ship.row,
        column: ship.column,
        orientation:
          ship.orientation === 'vertical'
            ? BattleshipOrientation.ORIENTATION_VERTICAL
            : BattleshipOrientation.ORIENTATION_HORIZONTAL,
      })),
    );
  };

  const send = (): void => {
    if (draftFleet(draft) === null) {
      onNotice('Place all five ships first.');
      return;
    }
    queued = true;
    report();
    flush();
  };

  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointerleave', onPointerLeave);
  container.addEventListener('pointercancel', onPointerLeave);
  container.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  const tick = (): void => {
    if (!running) {
      return;
    }
    frame = requestAnimationFrame(tick);
    // The rules have no fixed step here and nothing is interpolated between
    // two of them, so there is no alpha to pass: what moves on screen is water
    // and explosions, which the renderer times off its own clock.
    renderer.render(compose(), 0);
  };

  frame = requestAnimationFrame(tick);

  const onVisibilityChange = (): void => {
    if (document.hidden) {
      // A hidden tab is throttled to a crawl or stopped outright. Cancelling is
      // what stops it queueing frames it cannot draw.
      cancelAnimationFrame(frame);
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  report();

  return {
    rotate: turn,
    shuffle() {
      draft = shuffleDraft(draft);
      report();
    },
    clear() {
      draft = clearDraft(draft);
      report();
    },
    confirm: send,
    stop() {
      running = false;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointerleave', onPointerLeave);
      container.removeEventListener('pointercancel', onPointerLeave);
      container.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      resizeObserver.disconnect();
      void connection.leave();
      renderer.destroy();
    },
  };
}
