import { describe, expect, it } from 'vitest';
import {
  ARENA_ACTIONS,
  DEFAULT_ARENA_SETTINGS,
  actionBoundTo,
  applyLook,
  bindKey,
  clampPitch,
  labelForCode,
  readArenaSettings,
  writeArenaSettings,
} from '../src/features/game/arena-settings';

describe('arena settings', () => {
  it('start from defaults when there is nothing stored', () => {
    expect(readArenaSettings(undefined)).toEqual(DEFAULT_ARENA_SETTINGS);
    expect(readArenaSettings(null)).toEqual(DEFAULT_ARENA_SETTINGS);
    expect(readArenaSettings('nonsense')).toEqual(DEFAULT_ARENA_SETTINGS);
    expect(readArenaSettings([])).toEqual(DEFAULT_ARENA_SETTINGS);
  });

  it('survive a round trip through storage unchanged', () => {
    const tuned = bindKey(
      {
        ...DEFAULT_ARENA_SETTINGS,
        look: { ...DEFAULT_ARENA_SETTINGS.look, invertY: true, sensitivity: 0.004 },
        touch: { ...DEFAULT_ARENA_SETTINGS.touch, swapHalves: true },
      },
      'jump',
      'KeyE',
    ).settings;

    expect(readArenaSettings(writeArenaSettings(tuned))).toEqual(tuned);
  });

  it('fall back one field at a time, not wholesale', () => {
    // The kind of blob an older build, a truncated write or the Nakama console
    // produces. Everything sound in it has to survive.
    const restored = readArenaSettings({
      look: { sensitivity: 'fast', invertY: true, fieldOfView: 1.1 },
      keys: { forward: 'KeyZ', jump: 42 },
      touch: { swapHalves: true, stickReach: null },
    });

    // The broken ones are back to their defaults...
    expect(restored.look.sensitivity).toBe(DEFAULT_ARENA_SETTINGS.look.sensitivity);
    expect(restored.keys.jump).toBe(DEFAULT_ARENA_SETTINGS.keys.jump);
    expect(restored.touch.stickReach).toBe(DEFAULT_ARENA_SETTINGS.touch.stickReach);
    // ...and everything the player actually chose is still theirs.
    expect(restored.look.invertY).toBe(true);
    expect(restored.look.fieldOfView).toBe(1.1);
    expect(restored.keys.forward).toBe('KeyZ');
    expect(restored.touch.swapHalves).toBe(true);
  });

  it('pull a number that is out of range back into it', () => {
    const absurd = readArenaSettings({ look: { sensitivity: 900, fieldOfView: -3 } });
    expect(absurd.look.sensitivity).toBeLessThanOrEqual(0.02);
    expect(absurd.look.sensitivity).toBeGreaterThan(0);
    expect(absurd.look.fieldOfView).toBeGreaterThan(0);
  });

  it('refuse a stored blob that binds one key to two actions', () => {
    // Firing every time you walked forwards is the shape of this bug.
    const restored = readArenaSettings({ keys: { forward: 'KeyG', fire: 'KeyG' } });
    const codes = ARENA_ACTIONS.map((action) => restored.keys[action]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(restored.keys.forward).toBe('KeyG');
    expect(restored.keys.fire).toBe(DEFAULT_ARENA_SETTINGS.keys.fire);
  });
});

describe('rebinding', () => {
  it('refuses a key another action already holds, and says which', () => {
    const result = bindKey(DEFAULT_ARENA_SETTINGS, 'jump', DEFAULT_ARENA_SETTINGS.keys.forward);
    expect(result.refusedBecauseOf).toBe('forward');
    // Refused means unchanged: silently stealing the key would leave the player
    // unable to walk and no way to know why.
    expect(result.settings).toEqual(DEFAULT_ARENA_SETTINGS);
  });

  it('allows an action to be rebound to the key it already has', () => {
    const result = bindKey(DEFAULT_ARENA_SETTINGS, 'jump', DEFAULT_ARENA_SETTINGS.keys.jump);
    expect(result.refusedBecauseOf).toBeNull();
    expect(result.settings.keys.jump).toBe(DEFAULT_ARENA_SETTINGS.keys.jump);
  });

  it('accepts a free key and reports who holds what', () => {
    const result = bindKey(DEFAULT_ARENA_SETTINGS, 'crouch', 'KeyC');
    expect(result.refusedBecauseOf).toBeNull();
    expect(result.settings.keys.crouch).toBe('KeyC');
    expect(actionBoundTo(result.settings, 'KeyC')).toBe('crouch');
    expect(actionBoundTo(result.settings, 'KeyC')).not.toBe(actionBoundTo(result.settings, 'KeyW'));
  });
});

describe('look', () => {
  it('turns right and looks up by default', () => {
    // Screen coordinates grow downwards; pitch grows upwards. Getting this the
    // wrong way round is the single most complained-about default in the genre.
    const { yaw, pitch } = applyLook(10, -10, 0.01, false, false);
    expect(yaw).toBeGreaterThan(0);
    expect(pitch).toBeGreaterThan(0);
  });

  it('mirrors each axis independently when inverted', () => {
    const plain = applyLook(10, 10, 0.01, false, false);
    const invertedY = applyLook(10, 10, 0.01, false, true);
    const invertedX = applyLook(10, 10, 0.01, true, false);
    const both = applyLook(10, 10, 0.01, true, true);

    expect(invertedY.pitch).toBe(-plain.pitch);
    expect(invertedY.yaw).toBe(plain.yaw);
    expect(invertedX.yaw).toBe(-plain.yaw);
    expect(invertedX.pitch).toBe(plain.pitch);
    expect(both.yaw).toBe(-plain.yaw);
    expect(both.pitch).toBe(-plain.pitch);
  });

  it('scales with sensitivity', () => {
    expect(applyLook(10, 0, 0.02, false, false).yaw).toBeCloseTo(
      applyLook(10, 0, 0.01, false, false).yaw * 2,
      12,
    );
  });

  it('stops just short of straight up and straight down', () => {
    // Exactly at the pole the forward vector loses its horizontal component and
    // the move directions derived from it collapse.
    expect(clampPitch(99)).toBeLessThan(Math.PI / 2);
    expect(clampPitch(-99)).toBeGreaterThan(-Math.PI / 2);
    expect(Math.cos(clampPitch(99))).toBeGreaterThan(0);
    expect(clampPitch(0.4)).toBe(0.4);
  });
});

describe('key labels', () => {
  it('name the physical key rather than the character on it', () => {
    expect(labelForCode('KeyW')).toBe('W');
    expect(labelForCode('Digit1')).toBe('1');
    expect(labelForCode('Space')).toBe('Space');
    expect(labelForCode('ShiftLeft')).toBe('Left Shift');
    // Anything unrecognised is shown as it came, which is still more use than
    // an empty button.
    expect(labelForCode('IntlBackslash')).toBe('IntlBackslash');
  });
});
