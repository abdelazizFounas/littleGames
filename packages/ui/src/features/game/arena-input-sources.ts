import {
  aimToWire,
  clampToUnit,
  moveToWire,
  normalizeAim,
  type Seat,
  type Vec3,
} from '@littlegames/arena-logic';
import type { ArenaPlayerInput } from '@littlegames/core';
import {
  DEFAULT_ARENA_SETTINGS,
  applyLook,
  clampPitch,
  hasCoarsePointer,
  type ArenaSettings,
} from './arena-settings';

/**
 * Turning a keyboard, a mouse or two thumbs into one tick of intent.
 *
 * Everything device-shaped lives here and nothing else knows about any of it.
 * Two decisions run through the file.
 *
 * Keys are read from `event.code`, so `KeyW`/`KeyA`/`KeyS`/`KeyD` is ZQSD on an
 * AZERTY keyboard without a second mapping or a layout guess.
 *
 * And this is where trigonometry belongs. The player's yaw and pitch are
 * resolved into world-space vectors before anything leaves, so the simulation —
 * which exists twice and has to agree with itself to the last bit — never sees
 * an angle.
 */

/** One tick of intent, in the integers that go on the wire. */
export type ArenaCommand = ArenaPlayerInput;

export interface ArenaInput {
  start: () => void;
  /** Builds the command for this tick. */
  sample: (seq: number) => ArenaCommand;
  stop: () => void;
  /**
   * Advances anything that is a rate rather than an event.
   *
   * The aiming half of a touch screen is a stick: it says how fast to turn, not
   * how far, so it has to be integrated against real elapsed time. A mouse needs
   * none of this — it reports the distance it moved and nothing accumulates.
   */
  advance: (elapsedSeconds: number) => void;
  /** Where the player is looking right now, at frame rate rather than tick rate. */
  forward: () => Vec3;
  isZoomed: () => boolean;
  isLocked: () => boolean;
  /** Asks for pointer lock. Must be called from a real user gesture. */
  requestLock: () => void;
  /** Gives the pointer back on purpose, so a menu can be used. */
  releaseLock: () => void;
  setSettings: (next: ArenaSettings) => void;
  /** The newest server tick drawn, which is what the server rewinds from. */
  setSeenTick: (tick: number) => void;
  /** Points the view across the gap, which is where a seat starts out looking. */
  faceSeat: (seat: Seat) => void;
}

export interface ArenaInputListeners {
  /**
   * The browser refused to hide the pointer, and said why.
   *
   * Worth reporting rather than swallowing: without the pointer there is no
   * mouse look, no fire and no scope, and a game that simply does not answer
   * the mouse tells the player nothing about why.
   */
  onLockRefused: (reason: string) => void;
  /**
   * Pointer lock was gained or lost.
   *
   * `expected` says the loss was this client's own doing — a menu being opened
   * — rather than the player asking to get out. The difference matters: an
   * unexpected loss is how Escape arrives, because a browser spends that key
   * exiting the lock and never delivers it.
   */
  onLockChange: (locked: boolean, expected: boolean) => void;
  /** The settings key was pressed. */
  onOpenSettings: () => void;
}

/** Yaw and pitch as a world-space direction, which is all the rules accept. */
function directionOf(yaw: number, pitch: number): Vec3 {
  const flat = Math.cos(pitch);
  return { x: Math.sin(yaw) * flat, y: Math.sin(pitch), z: Math.cos(yaw) * flat };
}

/** Opens the settings panel. Not rebindable: it is the way out of the game. */
const SETTINGS_CODE = 'KeyP';

/**
 * Right-click raises the scope, so it must never also open a menu.
 *
 * Prevented on the window rather than on the canvas: while the pointer is
 * hidden the event does not necessarily target the canvas, and a context menu
 * that does open takes the pointer back with it — which is why right-clicking
 * stopped the camera dead instead of raising the scope.
 */
function onContextMenu(event: Event): void {
  event.preventDefault();
}

/** Buttons that always fire and zoom, whatever else is bound to them. */
const FIRE_BUTTON = 0;
const ZOOM_BUTTON = 2;

export function createArenaInput(
  surface: HTMLElement,
  /**
   * The box the canvas sits in, and where the touch controls are built.
   *
   * Not the canvas itself: a canvas may have children in the markup, but they
   * are fallback content for a browser that cannot draw one and are never
   * rendered. Built in there, the joystick and its buttons exist in the DOM,
   * answer `querySelector`, report a size of zero and are seen by nobody.
   */
  container: HTMLElement,
  listeners: ArenaInputListeners,
  initial: ArenaSettings = DEFAULT_ARENA_SETTINGS,
): ArenaInput {
  let settings = initial;

  let yaw = 0;
  let pitch = 0;
  let locked = false;
  let seenTick = 0;
  let shotsFired = 0;

  const held = new Set<string>();
  let zoomPressed = false;

  /**
   * Which device the player last actually used.
   *
   * A coarse pointer being *available* is not the same as there being nothing
   * else: a laptop with a touchscreen has both, and the touch layer sitting over
   * the canvas swallowed every mouse click on one. The layout follows the device
   * in the player's hand rather than the devices the machine happens to own.
   */
  let pointerMode: 'mouse' | 'touch' = hasCoarsePointer() ? 'touch' : 'mouse';

  /**
   * Whether the next loss of the pointer is one we asked for.
   *
   * Without it, opening the settings releases the lock, the release arrives a
   * moment later as a change event, and that event is indistinguishable from
   * the player pressing Escape — so a panel the player had just closed would
   * open again behind them.
   */
  let releasing = false;

  /**
   * The direction the crosshair had when the trigger was pulled.
   *
   * A shot is aimed at the moment of the click, not at the next tick boundary.
   * Up to sixteen milliseconds of mouse movement separates the two, and at the
   * distances in this arena that is the width of a body.
   */
  let latchedAim: Vec3 | null = null;

  // Touch, when there is a touch screen. Kept alongside the keyboard rather
  // than instead of it: a tablet with a keyboard should answer to both.
  let moveStickX = 0;
  let moveStickZ = 0;
  // The aiming half is a rate rather than a distance: while the thumb stays off
  // its neutral point the view keeps turning. It is integrated in `advance`,
  // against real elapsed time, or the turn speed would follow the frame rate.
  let turnStickX = 0;
  let turnStickY = 0;
  let touchJump = false;
  // Latched, so a stance survives the thumb leaving the button. Crouching is a
  // position you take, not a button you garrison.
  let touchCrouch = false;
  let touchZoom = false;
  let touchLayer: HTMLElement | null = null;
  let touchControls: { setSettings: (next: ArenaSettings) => void; dispose: () => void } | null =
    null;

  function look(deltaX: number, deltaY: number, sensitivity: number, invertY: boolean): void {
    const turn = applyLook(deltaX, deltaY, sensitivity, settings.look.invertX, invertY);
    yaw += turn.yaw;
    pitch = clampPitch(pitch + turn.pitch);
  }

  function fire(): void {
    // A counter, not a flag: the server credits one shot per number it has not
    // seen, so a command lost on the way costs nothing and a duplicate fires
    // nothing. One shot per press — the cooldown is most of half a second, so
    // there is nothing for holding the button to add.
    shotsFired += 1;
    latchedAim = directionOf(yaw, pitch);
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return;
    }
    if (event.code === SETTINGS_CODE) {
      event.preventDefault();
      listeners.onOpenSettings();
      return;
    }
    const bound = Object.values(settings.keys).includes(event.code);
    if (!bound) {
      return;
    }
    // Space scrolls the page and the arrow keys move the caret, both of which
    // are the last thing a player mid-duel wants.
    event.preventDefault();
    held.add(event.code);
    if (event.code === settings.keys.fire) {
      fire();
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.code);
  };

  /** A key held when the window loses focus never sends its keyup. */
  const onBlur = (): void => {
    held.clear();
    zoomPressed = false;
  };

  /**
   * Look, fire and scope all arrive as pointer events rather than mouse events.
   *
   * They are the superset, and they are what actually gets delivered: with the
   * pointer hidden, Firefox sends a `pointerdown` for a click and no `mousedown`
   * at all, so a game listening for the older pair silently never fires and
   * never scopes. `pointerType` keeps a finger out of this path — touch has its
   * own buttons, and a tap on the screen is not a trigger pull.
   */
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      return;
    }
    if (!locked) {
      // Without the lock the pointer is the page's, and moving it must not turn
      // the player. This is also what stops the view spinning while the
      // settings panel is open.
      return;
    }
    const sensitivity =
      settings.look.sensitivity * (isZoomedNow() ? settings.look.zoomSensitivity : 1);
    look(event.movementX, event.movementY, sensitivity, settings.look.invertY);
  };

  /**
   * Clicking the game takes the mouse.
   *
   * The request has to come from a real user gesture, and this is the one every
   * player makes without being told. It is on the surface rather than on the
   * window so that a click on the settings panel or the overlay is not also a
   * request to give the pointer back to the game.
   */
  function takePointer(): void {
    if (locked) {
      return;
    }
    // The truth arrives on `pointerlockchange`, but a refusal only ever arrives
    // here — and a refusal is the difference between a game that does not answer
    // the mouse and a game that says why.
    const asked: unknown = surface.requestPointerLock();
    if (asked instanceof Promise) {
      asked.catch((cause: unknown) => {
        listeners.onLockRefused(cause instanceof Error ? cause.message : String(cause));
      });
    }
  }

  /**
   * Clicking the game takes the mouse — but never for a finger.
   *
   * There is no pointer to hide on a touch screen, and asking anyway is what
   * made the settings open on almost every touch: a mobile browser grants the
   * lock and drops it again immediately, and a drop is what this game reads as
   * the player asking for the menu. The test is the pointer that arrived, not
   * what the machine is capable of.
   */
  const onSurfacePointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') {
      takePointer();
    }
  };

  /** A click as well, because not every browser grants a lock from a pointerdown. */
  const onSurfaceClick = (): void => {
    if (pointerMode !== 'touch') {
      takePointer();
    }
  };

  /** Follows the device actually in use, and hides the layout the other one needs. */
  const onAnyPointerDown = (event: PointerEvent): void => {
    const next = event.pointerType === 'touch' ? 'touch' : 'mouse';
    if (next === pointerMode) {
      return;
    }
    pointerMode = next;
    touchLayer?.classList.toggle('arena-touch--idle', next === 'mouse');
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || !locked) {
      return;
    }
    if (event.button === FIRE_BUTTON) {
      fire();
    }
    if (event.button === ZOOM_BUTTON) {
      zoomPressed = true;
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button === ZOOM_BUTTON) {
      zoomPressed = false;
    }
  };

  const onLockChange = (): void => {
    const next = document.pointerLockElement === surface;
    if (next === locked) {
      return;
    }
    locked = next;
    const expected = releasing;
    releasing = false;
    if (!locked) {
      // Whatever was held when the lock went is not held any more as far as the
      // player is concerned, and a forward key stuck down would walk them into
      // a wall while they read the menu.
      onBlur();
    }
    listeners.onLockChange(locked, expected);
  };

  function isZoomedNow(): boolean {
    return zoomPressed || held.has(settings.keys.zoom) || touchZoom;
  }

  /** The move vector, in the world rather than relative to the screen. */
  function moveVector(): { x: number; z: number } {
    const forwardAmount =
      (held.has(settings.keys.forward) ? 1 : 0) -
      (held.has(settings.keys.back) ? 1 : 0) -
      moveStickZ;
    const strafeAmount =
      (held.has(settings.keys.right) ? 1 : 0) -
      (held.has(settings.keys.left) ? 1 : 0) +
      moveStickX;

    // Rotated by the player's own yaw here, in the input source, so that the
    // rules receive a direction in the world and never an angle.
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    return clampToUnit({
      x: sin * forwardAmount + cos * strafeAmount,
      z: cos * forwardAmount - sin * strafeAmount,
    });
  }

  return {
    start() {
      window.addEventListener('keydown', onKeyDown, { passive: false });
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('contextmenu', onContextMenu, { capture: true });
      surface.addEventListener('pointerdown', onSurfacePointerDown);
      surface.addEventListener('click', onSurfaceClick);
      container.addEventListener('pointerdown', onAnyPointerDown, { capture: true });
      document.addEventListener('pointerlockchange', onLockChange);

      // Chosen by what the device can do, never by what it calls itself: a
      // user-agent string is a claim, and a coarse pointer is a fact.
      // Built whenever a finger is possible, and hidden while a mouse is the
      // thing being used. A machine with both gets both.
      if (hasCoarsePointer()) {
        const built = buildTouchControls(container, settings, {
          onMove: (x, z) => {
            moveStickX = x;
            moveStickZ = z;
          },
          onTurn: (x, y) => {
            turnStickX = x;
            turnStickY = y;
          },
          onFire: fire,
          onHold: (_action, pressed) => {
            touchJump = pressed;
          },
          onToggle: (action) => {
            if (action === 'crouch') {
              touchCrouch = !touchCrouch;
              return touchCrouch;
            }
            touchZoom = !touchZoom;
            return touchZoom;
          },
          onOpenSettings: listeners.onOpenSettings,
        });
        touchLayer = built.element;
        touchControls = built;
        touchLayer.classList.toggle('arena-touch--idle', pointerMode === 'mouse');
      }
    },

    sample(seq) {
      const move = moveVector();
      // The latched aim is spent on the tick after the click, so the shot goes
      // where the crosshair was rather than where it has drifted to.
      const aim = normalizeAim(latchedAim ?? directionOf(yaw, pitch));
      latchedAim = null;

      const wiredMove = moveToWire(move);
      const wiredAim = aimToWire(aim);

      return {
        seq,
        moveX: wiredMove.x,
        moveZ: wiredMove.z,
        aimX: wiredAim.x,
        aimY: wiredAim.y,
        aimZ: wiredAim.z,
        jump: held.has(settings.keys.jump) || touchJump,
        crouch: held.has(settings.keys.crouch) || touchCrouch,
        zoomed: isZoomedNow(),
        seenTick,
        shotsFired,
      };
    },

    stop() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      surface.removeEventListener('pointerdown', onSurfacePointerDown);
      surface.removeEventListener('click', onSurfaceClick);
      container.removeEventListener('pointerdown', onAnyPointerDown, { capture: true });
      document.removeEventListener('pointerlockchange', onLockChange);
      touchControls?.dispose();
      touchLayer?.remove();
      touchLayer = null;
      touchControls = null;
      held.clear();
      if (document.pointerLockElement === surface) {
        document.exitPointerLock();
      }
    },

    advance(elapsedSeconds) {
      if (turnStickX === 0 && turnStickY === 0) {
        return;
      }
      const speed = settings.touch.sensitivity * (isZoomedNow() ? settings.look.zoomSensitivity : 1);
      // Through the same `applyLook` the mouse uses, so the inversions are
      // applied once and in one place — and so the vertical axis agrees between
      // a thumb and a mouse without either being special.
      look(turnStickX, turnStickY, speed * elapsedSeconds, settings.touch.invertY);
    },

    forward: () => directionOf(yaw, pitch),
    isZoomed: isZoomedNow,
    isLocked: () => locked,
    requestLock() {
      releasing = false;
      takePointer();
    },
    releaseLock() {
      if (document.pointerLockElement === surface) {
        releasing = true;
        document.exitPointerLock();
      }
    },
    setSettings(next) {
      settings = next;
      touchControls?.setSettings(next);
    },
    setSeenTick(tick) {
      seenTick = tick;
    },
    faceSeat(seat) {
      // Each seat opens looking across the gap at the other one. North's spawn
      // aim is +z, which is yaw zero; south's is -z, which is half a turn.
      yaw = seat === 'north' ? 0 : Math.PI;
      pitch = 0;
    },
  };
}

/**
 * Keeps a gesture attached to the element that started it, if it can.
 *
 * Capture is an improvement, not a requirement: it is what keeps the stick
 * following a thumb that slides off it. The browser refuses when the pointer is
 * no longer active, and that refusal is a thrown error — which, left alone, is
 * an uncaught exception on every single touch.
 */
function keepPointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Uncaptured: the gesture still works while the finger stays on it.
  }
}

interface TouchHandlers {
  /** Movement intent, already clamped to at most unit length. */
  onMove: (x: number, z: number) => void;
  /** Turn rate, in units of full deflection, for the frame loop to integrate. */
  onTurn: (x: number, y: number) => void;
  onFire: () => void;
  /** Held only while the thumb is on it. Jumping is an instant, not a stance. */
  onHold: (action: 'jump', pressed: boolean) => void;
  /**
   * A latching control: crouch and scope stay where they were put.
   *
   * Answers with the new state, because a button that latches and does not look
   * latched leaves the player guessing whether they are crouched — and the
   * answer is otherwise only visible as seven centimetres of eye height.
   */
  onToggle: (action: 'crouch' | 'zoom') => boolean;
  onOpenSettings: () => void;
}

/** Shows a latching button as latched, because otherwise nothing does. */
function latch(button: HTMLButtonElement, on: boolean): void {
  button.classList.toggle('arena-touch__button--on', on);
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/** One thumb, and the point it decided was the middle. */
interface Stick {
  pointerId: number | null;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

function restStick(): Stick {
  return { pointerId: null, originX: 0, originY: 0, x: 0, y: 0 };
}

/** Lets a stick go, if the finger lifting is the one that owned it. */
function releaseStick(stick: Stick, mark: HTMLElement, event: PointerEvent): void {
  if (event.pointerId !== stick.pointerId) {
    return;
  }
  stick.pointerId = null;
  stick.x = 0;
  stick.y = 0;
  mark.style.opacity = '0';
}

/**
 * The touch layout: two floating sticks, three buttons and a gear.
 *
 * Each half of the screen is a stick with no fixed position. Where the thumb
 * lands is the middle, and the offset from that point is the input; lift the
 * thumb and put it down somewhere else and that somewhere else becomes the new
 * middle. A drawn joystick has to be found before it can be used, and a thumb
 * that wanders off one stops driving it — which is exactly what went wrong with
 * the fixed circle this replaces.
 *
 * The left half moves and the right half turns, or the other way round. Every
 * gesture claims a `pointerId` when it starts and ignores every other for as
 * long as it lasts: the classic bug in a touch shooter is the movement thumb
 * dying the instant the aiming thumb lands.
 */
function buildTouchControls(
  container: HTMLElement,
  settings: ArenaSettings,
  handlers: TouchHandlers,
): { element: HTMLElement; setSettings: (next: ArenaSettings) => void; dispose: () => void } {
  let current = settings;

  const layer = document.createElement('div');
  layer.className = 'arena-touch';

  const moveZone = document.createElement('div');
  moveZone.className = 'arena-touch__zone arena-touch__zone--move';
  const turnZone = document.createElement('div');
  turnZone.className = 'arena-touch__zone arena-touch__zone--turn';

  // Drawn only while a thumb is down, and drawn where the thumb is.
  const moveMark = document.createElement('div');
  moveMark.className = 'arena-touch__mark';
  const turnMark = document.createElement('div');
  turnMark.className = 'arena-touch__mark';

  const buttons = document.createElement('div');
  buttons.className = 'arena-touch__buttons';

  function makeButton(label: string, modifier: string): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `arena-touch__button arena-touch__button--${modifier}`;
    element.textContent = label;
    buttons.appendChild(element);
    return element;
  }

  const fireButton = makeButton('Fire', 'fire');
  const jumpButton = makeButton('Jump', 'jump');
  const crouchButton = makeButton('Crouch', 'crouch');
  const zoomButton = makeButton('Scope', 'zoom');

  // A gear, rather than the settings appearing by themselves. On a phone there
  // is no pointer to lose and no Escape key, so there is nothing for the game to
  // read as "the player wants the menu" — it has to be asked for.
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'arena-touch__gear';
  gear.setAttribute('aria-label', 'Settings');
  gear.textContent = '\u2699';

  layer.append(moveZone, turnZone, moveMark, turnMark, buttons, gear);
  container.appendChild(layer);

  const move = restStick();
  const turn = restStick();

  function applySwap(): void {
    layer.classList.toggle('arena-touch--swapped', current.touch.swapHalves);
  }
  applySwap();

  /** Full deflection, in pixels, from the fraction of the smaller dimension. */
  function reach(): number {
    const bounds = layer.getBoundingClientRect();
    return Math.max(Math.min(bounds.width, bounds.height) * current.touch.stickReach, 24);
  }

  function track(stick: Stick, mark: HTMLElement, event: PointerEvent): void {
    const radius = reach();
    const offsetX = (event.clientX - stick.originX) / radius;
    const offsetY = (event.clientY - stick.originY) / radius;
    const clamped = clampToUnit({ x: offsetX, z: offsetY });
    stick.x = clamped.x;
    stick.y = clamped.z;
    mark.style.transform =
      `translate(${String(stick.originX + clamped.x * radius)}px, ` +
      `${String(stick.originY + clamped.z * radius)}px)`;
  }

  function begin(stick: Stick, mark: HTMLElement, zone: HTMLElement, event: PointerEvent): void {
    if (stick.pointerId !== null) {
      return;
    }
    stick.pointerId = event.pointerId;
    // Where the thumb landed is the middle. Nothing is centred on the zone.
    stick.originX = event.clientX;
    stick.originY = event.clientY;
    stick.x = 0;
    stick.y = 0;
    keepPointer(zone, event.pointerId);
    mark.style.left = '0';
    mark.style.top = '0';
    mark.style.opacity = '1';
    track(stick, mark, event);
  }

  const onMoveDown = (event: PointerEvent): void => {
    begin(move, moveMark, moveZone, event);
    handlers.onMove(move.x, move.y);
  };
  const onMoveMove = (event: PointerEvent): void => {
    if (event.pointerId !== move.pointerId) {
      return;
    }
    track(move, moveMark, event);
    handlers.onMove(move.x, move.y);
  };
  const onMoveUp = (event: PointerEvent): void => {
    releaseStick(move, moveMark, event);
    handlers.onMove(0, 0);
  };

  const onTurnDown = (event: PointerEvent): void => {
    begin(turn, turnMark, turnZone, event);
    handlers.onTurn(turn.x, turn.y);
  };
  const onTurnMove = (event: PointerEvent): void => {
    if (event.pointerId !== turn.pointerId) {
      return;
    }
    track(turn, turnMark, event);
    handlers.onTurn(turn.x, turn.y);
  };
  const onTurnUp = (event: PointerEvent): void => {
    releaseStick(turn, turnMark, event);
    handlers.onTurn(0, 0);
  };

  const onFireDown = (event: PointerEvent): void => {
    event.preventDefault();
    handlers.onFire();
  };
  const onJumpDown = (event: PointerEvent): void => {
    event.preventDefault();
    keepPointer(jumpButton, event.pointerId);
    handlers.onHold('jump', true);
  };
  const onJumpUp = (): void => {
    handlers.onHold('jump', false);
  };
  latch(crouchButton, false);
  latch(zoomButton, false);

  const onCrouchDown = (event: PointerEvent): void => {
    event.preventDefault();
    latch(crouchButton, handlers.onToggle('crouch'));
  };
  const onZoomDown = (event: PointerEvent): void => {
    event.preventDefault();
    latch(zoomButton, handlers.onToggle('zoom'));
  };
  const onGearDown = (event: PointerEvent): void => {
    event.preventDefault();
    handlers.onOpenSettings();
  };

  moveZone.addEventListener('pointerdown', onMoveDown);
  moveZone.addEventListener('pointermove', onMoveMove);
  moveZone.addEventListener('pointerup', onMoveUp);
  moveZone.addEventListener('pointercancel', onMoveUp);
  turnZone.addEventListener('pointerdown', onTurnDown);
  turnZone.addEventListener('pointermove', onTurnMove);
  turnZone.addEventListener('pointerup', onTurnUp);
  turnZone.addEventListener('pointercancel', onTurnUp);
  fireButton.addEventListener('pointerdown', onFireDown);
  jumpButton.addEventListener('pointerdown', onJumpDown);
  jumpButton.addEventListener('pointerup', onJumpUp);
  jumpButton.addEventListener('pointercancel', onJumpUp);
  crouchButton.addEventListener('pointerdown', onCrouchDown);
  zoomButton.addEventListener('pointerdown', onZoomDown);
  gear.addEventListener('pointerdown', onGearDown);

  return {
    element: layer,
    setSettings(next) {
      current = next;
      applySwap();
    },
    dispose() {
      moveZone.removeEventListener('pointerdown', onMoveDown);
      moveZone.removeEventListener('pointermove', onMoveMove);
      moveZone.removeEventListener('pointerup', onMoveUp);
      moveZone.removeEventListener('pointercancel', onMoveUp);
      turnZone.removeEventListener('pointerdown', onTurnDown);
      turnZone.removeEventListener('pointermove', onTurnMove);
      turnZone.removeEventListener('pointerup', onTurnUp);
      turnZone.removeEventListener('pointercancel', onTurnUp);
      fireButton.removeEventListener('pointerdown', onFireDown);
      jumpButton.removeEventListener('pointerdown', onJumpDown);
      jumpButton.removeEventListener('pointerup', onJumpUp);
      jumpButton.removeEventListener('pointercancel', onJumpUp);
      crouchButton.removeEventListener('pointerdown', onCrouchDown);
      zoomButton.removeEventListener('pointerdown', onZoomDown);
      gear.removeEventListener('pointerdown', onGearDown);
    },
  };
}
