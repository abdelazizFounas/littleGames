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

/** Right-click is the zoom, so it must not also open a menu over the game. */
function onContextMenu(event: Event): void {
  event.preventDefault();
}

/** Buttons that always fire and zoom, whatever else is bound to them. */
const FIRE_BUTTON = 0;
const ZOOM_BUTTON = 2;

export function createArenaInput(
  surface: HTMLElement,
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
  let stickX = 0;
  let stickZ = 0;
  const touchHeld = new Set<'jump' | 'crouch' | 'zoom'>();
  let touchLayer: HTMLElement | null = null;
  let disposeTouch: (() => void) | null = null;

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

  const onMouseMove = (event: MouseEvent): void => {
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
  const onSurfacePointerDown = (): void => {
    if (!locked) {
      // The browser may refuse, and the truth arrives on `pointerlockchange`
      // rather than from this call, so the promise is nothing to wait on.
      void surface.requestPointerLock();
    }
  };

  const onMouseDown = (event: MouseEvent): void => {
    if (!locked) {
      return;
    }
    if (event.button === FIRE_BUTTON) {
      fire();
    }
    if (event.button === ZOOM_BUTTON) {
      zoomPressed = true;
    }
  };

  const onMouseUp = (event: MouseEvent): void => {
    if (event.button === ZOOM_BUTTON) {
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
    return zoomPressed || held.has(settings.keys.zoom) || touchHeld.has('zoom');
  }

  /** The move vector, in the world rather than relative to the screen. */
  function moveVector(): { x: number; z: number } {
    const forwardAmount =
      (held.has(settings.keys.forward) ? 1 : 0) - (held.has(settings.keys.back) ? 1 : 0) - stickZ;
    const strafeAmount =
      (held.has(settings.keys.right) ? 1 : 0) - (held.has(settings.keys.left) ? 1 : 0) + stickX;

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
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      surface.addEventListener('contextmenu', onContextMenu);
      surface.addEventListener('pointerdown', onSurfacePointerDown);
      document.addEventListener('pointerlockchange', onLockChange);

      // Chosen by what the device can do, never by what it calls itself: a
      // user-agent string is a claim, and a coarse pointer is a fact.
      if (window.matchMedia('(pointer: coarse)').matches) {
        const built = buildTouchControls(surface, settings, {
          onStick: (x, z) => {
            stickX = x;
            stickZ = z;
          },
          onLook: (deltaX, deltaY) => {
            look(deltaX, deltaY, settings.touch.sensitivity, settings.touch.invertY);
          },
          onFire: fire,
          onHold: (action, pressed) => {
            if (pressed) {
              touchHeld.add(action);
            } else {
              touchHeld.delete(action);
            }
          },
        });
        touchLayer = built.element;
        disposeTouch = built.dispose;
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
        jump: held.has(settings.keys.jump) || touchHeld.has('jump'),
        crouch: held.has(settings.keys.crouch) || touchHeld.has('crouch'),
        zoomed: isZoomedNow(),
        seenTick,
        shotsFired,
      };
    },

    stop() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      surface.removeEventListener('contextmenu', onContextMenu);
      surface.removeEventListener('pointerdown', onSurfacePointerDown);
      document.removeEventListener('pointerlockchange', onLockChange);
      disposeTouch?.();
      touchLayer?.remove();
      touchLayer = null;
      disposeTouch = null;
      held.clear();
      if (document.pointerLockElement === surface) {
        document.exitPointerLock();
      }
    },

    forward: () => directionOf(yaw, pitch),
    isZoomed: isZoomedNow,
    isLocked: () => locked,
    requestLock() {
      // Nothing is assumed about the outcome: the browser may refuse, and the
      // truth arrives on `pointerlockchange` rather than from this call.
      releasing = false;
      void surface.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement === surface) {
        releasing = true;
        document.exitPointerLock();
      }
    },
    setSettings(next) {
      settings = next;
      touchLayer?.style.setProperty('--stick-size', `${String(next.touch.joystickSize * 100)}vmin`);
      touchLayer?.classList.toggle('arena-touch--left-handed', next.touch.leftHanded);
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

interface TouchHandlers {
  onStick: (x: number, z: number) => void;
  onLook: (deltaX: number, deltaY: number) => void;
  onFire: () => void;
  onHold: (action: 'jump' | 'crouch' | 'zoom', pressed: boolean) => void;
}

/**
 * The touch layout: a stick, a look surface, and four buttons.
 *
 * Every gesture claims a `pointerId` at the moment it starts and ignores every
 * other for as long as it lasts. The classic bug in a touch shooter is the
 * joystick dying the instant the look finger lands, and it is exactly this:
 * handlers that track "the" pointer rather than their own.
 *
 * Built as plain DOM inside the surface, so it is inside the element that goes
 * fullscreen and stays visible there.
 */
function buildTouchControls(
  surface: HTMLElement,
  settings: ArenaSettings,
  handlers: TouchHandlers,
): { element: HTMLElement; dispose: () => void } {
  const layer = document.createElement('div');
  layer.className = 'arena-touch';
  layer.classList.toggle('arena-touch--left-handed', settings.touch.leftHanded);
  layer.style.setProperty('--stick-size', `${String(settings.touch.joystickSize * 100)}vmin`);

  const lookArea = document.createElement('div');
  lookArea.className = 'arena-touch__look';

  const stick = document.createElement('div');
  stick.className = 'arena-touch__stick';
  const knob = document.createElement('div');
  knob.className = 'arena-touch__knob';
  stick.appendChild(knob);

  const buttons = document.createElement('div');
  buttons.className = 'arena-touch__buttons';

  function makeButton(label: string, className: string): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `arena-touch__button ${className}`;
    element.textContent = label;
    buttons.appendChild(element);
    return element;
  }

  const fireButton = makeButton('Fire', 'arena-touch__button--fire');
  const jumpButton = makeButton('Jump', 'arena-touch__button--jump');
  const crouchButton = makeButton('Crouch', 'arena-touch__button--crouch');
  const zoomButton = makeButton('Zoom', 'arena-touch__button--zoom');

  layer.append(lookArea, stick, buttons);
  surface.appendChild(layer);

  let stickPointer: number | null = null;
  let lookPointer: number | null = null;
  let lastLookX = 0;
  let lastLookY = 0;

  const onStickDown = (event: PointerEvent): void => {
    if (stickPointer !== null) {
      return;
    }
    stickPointer = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    trackStick(event);
  };

  function trackStick(event: PointerEvent): void {
    const bounds = stick.getBoundingClientRect();
    const radius = bounds.width / 2;
    if (radius === 0) {
      return;
    }
    const offsetX = (event.clientX - (bounds.left + radius)) / radius;
    const offsetY = (event.clientY - (bounds.top + radius)) / radius;
    const clamped = clampToUnit({ x: offsetX, z: offsetY });
    knob.style.transform = `translate(${String(clamped.x * radius * 0.6)}px, ${String(clamped.z * radius * 0.6)}px)`;
    handlers.onStick(clamped.x, clamped.z);
  }

  const onStickMove = (event: PointerEvent): void => {
    if (event.pointerId === stickPointer) {
      trackStick(event);
    }
  };

  const onStickUp = (event: PointerEvent): void => {
    if (event.pointerId !== stickPointer) {
      return;
    }
    stickPointer = null;
    knob.style.transform = '';
    handlers.onStick(0, 0);
  };

  const onLookDown = (event: PointerEvent): void => {
    if (lookPointer !== null) {
      return;
    }
    lookPointer = event.pointerId;
    lastLookX = event.clientX;
    lastLookY = event.clientY;
    lookArea.setPointerCapture(event.pointerId);
  };

  const onLookMove = (event: PointerEvent): void => {
    if (event.pointerId !== lookPointer) {
      return;
    }
    handlers.onLook(event.clientX - lastLookX, event.clientY - lastLookY);
    lastLookX = event.clientX;
    lastLookY = event.clientY;
  };

  const onLookUp = (event: PointerEvent): void => {
    if (event.pointerId === lookPointer) {
      lookPointer = null;
    }
  };

  const onFireDown = (event: PointerEvent): void => {
    event.preventDefault();
    handlers.onFire();
  };

  function holdButton(
    element: HTMLElement,
    action: 'jump' | 'crouch' | 'zoom',
  ): { down: (event: PointerEvent) => void; up: (event: PointerEvent) => void } {
    const down = (event: PointerEvent): void => {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      handlers.onHold(action, true);
    };
    const up = (): void => {
      handlers.onHold(action, false);
    };
    return { down, up };
  }

  const jump = holdButton(jumpButton, 'jump');
  const crouch = holdButton(crouchButton, 'crouch');
  const zoom = holdButton(zoomButton, 'zoom');

  stick.addEventListener('pointerdown', onStickDown);
  stick.addEventListener('pointermove', onStickMove);
  stick.addEventListener('pointerup', onStickUp);
  stick.addEventListener('pointercancel', onStickUp);
  lookArea.addEventListener('pointerdown', onLookDown);
  lookArea.addEventListener('pointermove', onLookMove);
  lookArea.addEventListener('pointerup', onLookUp);
  lookArea.addEventListener('pointercancel', onLookUp);
  fireButton.addEventListener('pointerdown', onFireDown);
  jumpButton.addEventListener('pointerdown', jump.down);
  jumpButton.addEventListener('pointerup', jump.up);
  jumpButton.addEventListener('pointercancel', jump.up);
  crouchButton.addEventListener('pointerdown', crouch.down);
  crouchButton.addEventListener('pointerup', crouch.up);
  crouchButton.addEventListener('pointercancel', crouch.up);
  zoomButton.addEventListener('pointerdown', zoom.down);
  zoomButton.addEventListener('pointerup', zoom.up);
  zoomButton.addEventListener('pointercancel', zoom.up);

  return {
    element: layer,
    dispose() {
      stick.removeEventListener('pointerdown', onStickDown);
      stick.removeEventListener('pointermove', onStickMove);
      stick.removeEventListener('pointerup', onStickUp);
      stick.removeEventListener('pointercancel', onStickUp);
      lookArea.removeEventListener('pointerdown', onLookDown);
      lookArea.removeEventListener('pointermove', onLookMove);
      lookArea.removeEventListener('pointerup', onLookUp);
      lookArea.removeEventListener('pointercancel', onLookUp);
      fireButton.removeEventListener('pointerdown', onFireDown);
      jumpButton.removeEventListener('pointerdown', jump.down);
      jumpButton.removeEventListener('pointerup', jump.up);
      jumpButton.removeEventListener('pointercancel', jump.up);
      crouchButton.removeEventListener('pointerdown', crouch.down);
      crouchButton.removeEventListener('pointerup', crouch.up);
      crouchButton.removeEventListener('pointercancel', crouch.up);
      zoomButton.removeEventListener('pointerdown', zoom.down);
      zoomButton.removeEventListener('pointerup', zoom.up);
      zoomButton.removeEventListener('pointercancel', zoom.up);
    },
  };
}
