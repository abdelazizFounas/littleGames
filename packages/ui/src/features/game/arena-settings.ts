/**
 * What a player has tuned, and everything that decides whether it is valid.
 *
 * A pure module with no browser in it, so all of it can be tested in Node: the
 * defaults, the per-field fallback that keeps a corrupt stored blob from
 * breaking somebody's controls, the refusal to bind one key to two actions, and
 * the arithmetic that turns a mouse movement into a look.
 *
 * Keys are stored as `event.code`, never `event.key`. A code names the physical
 * key, so `KeyW`/`KeyA`/`KeyS`/`KeyD` is already ZQSD on an AZERTY keyboard and
 * WASD on a QWERTY one, with no second mapping and no detection. It also means
 * a binding survives the player switching layouts mid-match, which `event.key`
 * would not.
 */

/** Everything a player can ask the game to do. */
export type ArenaAction = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'fire' | 'zoom';

export const ARENA_ACTIONS: readonly ArenaAction[] = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'crouch',
  'fire',
  'zoom',
];

export interface LookSettings {
  /** Radians of turn per pixel of mouse movement. */
  readonly sensitivity: number;
  readonly invertY: boolean;
  readonly invertX: boolean;
  /** Multiplies sensitivity while zoomed. Below one is a steadier aim. */
  readonly zoomSensitivity: number;
  /** Vertical field of view, in radians. */
  readonly fieldOfView: number;
}

export interface TouchSettings {
  /**
   * Radians a second the view turns at full deflection.
   *
   * A rate, not a distance: the aiming half of the screen is a stick whose
   * neutral point is wherever the thumb landed, and the view keeps turning for
   * as long as the thumb stays away from it.
   */
  readonly sensitivity: number;
  readonly invertY: boolean;
  /** Puts moving under the right thumb and aiming under the left. */
  readonly swapHalves: boolean;
  /**
   * How far the thumb travels for full deflection, as a fraction of the smaller
   * screen dimension. Both sticks float, so this is a distance rather than the
   * size of anything drawn.
   */
  readonly stickReach: number;
}

export interface ArenaSettings {
  readonly look: LookSettings;
  readonly keys: Readonly<Record<ArenaAction, string>>;
  readonly touch: TouchSettings;
}

/**
 * The defaults, and what every invalid field falls back to.
 *
 * Fire and zoom carry keys as well as mouse buttons. The left and right buttons
 * always do both and are not rebindable — a first-person game that let you
 * unbind firing would be a first-person game you could not play — but a laptop
 * trackpad makes right-click awkward enough to be worth a key beside it.
 */
export const DEFAULT_ARENA_SETTINGS: ArenaSettings = {
  look: {
    sensitivity: 0.0022,
    invertY: false,
    invertX: false,
    zoomSensitivity: 0.6,
    fieldOfView: 1.4,
  },
  keys: {
    forward: 'KeyW',
    back: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    jump: 'Space',
    crouch: 'ShiftLeft',
    fire: 'KeyF',
    zoom: 'KeyQ',
  },
  touch: {
    sensitivity: 2.6,
    invertY: false,
    swapHalves: false,
    stickReach: 0.14,
  },
};

/** The range each number is allowed to take, and clamped into. */
const LIMITS = {
  sensitivity: { min: 0.0002, max: 0.02 },
  zoomSensitivity: { min: 0.1, max: 2 },
  fieldOfView: { min: 0.7, max: 2 },
  touchSensitivity: { min: 0.4, max: 8 },
  stickReach: { min: 0.06, max: 0.3 },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A number inside its range, or the default when it is neither. */
function number(
  source: Record<string, unknown>,
  field: string,
  fallback: number,
  limit: { readonly min: number; readonly max: number },
): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, limit.min), limit.max);
}

function boolean(source: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const value = source[field];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * A stored blob back into settings, one field at a time.
 *
 * Per field rather than all or nothing, and that is the whole point: a blob
 * written by an older build, hand-edited in the Nakama console, or truncated by
 * a storage quota should cost a player the one setting that is broken, not
 * every setting they have. A wholesale reset is the answer that loses the most
 * for the least reason.
 */
export function readArenaSettings(stored: unknown): ArenaSettings {
  if (!isRecord(stored)) {
    return DEFAULT_ARENA_SETTINGS;
  }

  const look = isRecord(stored['look']) ? stored['look'] : {};
  const touch = isRecord(stored['touch']) ? stored['touch'] : {};
  const keys = isRecord(stored['keys']) ? stored['keys'] : {};

  const bound: Record<ArenaAction, string> = { ...DEFAULT_ARENA_SETTINGS.keys };
  for (const action of ARENA_ACTIONS) {
    const code = keys[action];
    // A code has to be a non-empty string, and it has to be free. A stored blob
    // that binds two actions to one key would otherwise fire every time the
    // player walked forwards.
    if (typeof code === 'string' && code !== '' && !Object.values(bound).includes(code)) {
      bound[action] = code;
    }
  }

  return {
    look: {
      sensitivity: number(
        look,
        'sensitivity',
        DEFAULT_ARENA_SETTINGS.look.sensitivity,
        LIMITS.sensitivity,
      ),
      invertY: boolean(look, 'invertY', DEFAULT_ARENA_SETTINGS.look.invertY),
      invertX: boolean(look, 'invertX', DEFAULT_ARENA_SETTINGS.look.invertX),
      zoomSensitivity: number(
        look,
        'zoomSensitivity',
        DEFAULT_ARENA_SETTINGS.look.zoomSensitivity,
        LIMITS.zoomSensitivity,
      ),
      fieldOfView: number(
        look,
        'fieldOfView',
        DEFAULT_ARENA_SETTINGS.look.fieldOfView,
        LIMITS.fieldOfView,
      ),
    },
    keys: bound,
    touch: {
      sensitivity: number(
        touch,
        'sensitivity',
        DEFAULT_ARENA_SETTINGS.touch.sensitivity,
        LIMITS.touchSensitivity,
      ),
      invertY: boolean(touch, 'invertY', DEFAULT_ARENA_SETTINGS.touch.invertY),
      swapHalves: boolean(touch, 'swapHalves', DEFAULT_ARENA_SETTINGS.touch.swapHalves),
      stickReach: number(
        touch,
        'stickReach',
        DEFAULT_ARENA_SETTINGS.touch.stickReach,
        LIMITS.stickReach,
      ),
    },
  };
}

/** Settings as a plain record, for storage. */
export function writeArenaSettings(settings: ArenaSettings): Record<string, unknown> {
  return { look: { ...settings.look }, keys: { ...settings.keys }, touch: { ...settings.touch } };
}

/** Which action already holds a code, if any. */
export function actionBoundTo(settings: ArenaSettings, code: string): ArenaAction | null {
  return ARENA_ACTIONS.find((action) => settings.keys[action] === code) ?? null;
}

/**
 * Binds a key to an action, or refuses.
 *
 * Refused rather than stolen from whichever action held it, because a silent
 * theft leaves the player with an action they can no longer perform and no way
 * to know which one it was. Rebinding a key to the action that already holds it
 * is not a conflict; it is a player changing their mind back.
 */
export function bindKey(
  settings: ArenaSettings,
  action: ArenaAction,
  code: string,
): { readonly settings: ArenaSettings; readonly refusedBecauseOf: ArenaAction | null } {
  const holder = actionBoundTo(settings, code);
  if (holder !== null && holder !== action) {
    return { settings, refusedBecauseOf: holder };
  }
  return {
    settings: { ...settings, keys: { ...settings.keys, [action]: code } },
    refusedBecauseOf: null,
  };
}

/**
 * How far a look moves, given a raw device movement.
 *
 * The inversions live here rather than in the input source so that they can be
 * tested without a pointer, and so both devices apply them the same way. Screen
 * coordinates grow downwards while pitch grows upwards, which is why the
 * uninverted vertical case already carries a minus sign.
 */
export function applyLook(
  deltaX: number,
  deltaY: number,
  sensitivity: number,
  invertX: boolean,
  invertY: boolean,
): { readonly yaw: number; readonly pitch: number } {
  return {
    yaw: deltaX * sensitivity * (invertX ? -1 : 1),
    pitch: -deltaY * sensitivity * (invertY ? -1 : 1),
  };
}

/** Straight up and straight down, just short of the pole the maths dislikes. */
export const MAX_PITCH = Math.PI / 2 - 0.001;

export function clampPitch(pitch: number): number {
  return Math.min(Math.max(pitch, -MAX_PITCH), MAX_PITCH);
}

/**
 * How much the sight magnifies.
 *
 * Six, which is a sniper's scope rather than a rifle's. It narrows the field of
 * view by the same factor — that is all magnification is.
 */
export const SCOPE_MAGNIFICATION = 6;

/** How long the sight takes to come up, in milliseconds. */
export const SCOPE_RAISE_MS = 150;

/**
 * Whether this device is driven by fingers rather than a pointer.
 *
 * Asked of the device rather than of the user-agent string: a user-agent is a
 * claim, and a coarse pointer is a fact. It decides the touch layout, and it
 * also decides that pointer lock is never asked for — asking on a phone is what
 * made the settings open on almost every touch.
 */
export function hasCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

const CODE_LABELS: Readonly<Record<string, string>> = {
  Space: 'Space',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Tab: 'Tab',
  Enter: 'Enter',
  Backquote: 'Backtick',
};

/**
 * A key code as something to print on a button.
 *
 * It names the physical key, not the letter printed on it, so `KeyA` reads "A"
 * even on the AZERTY keyboard where that key produces a Q. Saying "A" and
 * meaning "the key where A is on a QWERTY board" is the honest compromise: the
 * alternative is asking the browser for a layout it will not reliably give.
 */
export function labelForCode(code: string): string {
  const named = CODE_LABELS[code];
  if (named !== undefined) {
    return named;
  }
  if (code.startsWith('Key')) {
    return code.slice(3);
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }
  return code;
}
