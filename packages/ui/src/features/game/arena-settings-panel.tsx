import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ARENA_ACTIONS,
  DEFAULT_ARENA_SETTINGS,
  bindKey,
  labelForCode,
  type ArenaAction,
  type ArenaSettings,
} from './arena-settings';

/**
 * The settings, inside the game.
 *
 * It renders inside the element that goes fullscreen, which is a structural
 * requirement rather than a styling one: anything outside that element is
 * simply not on screen while fullscreen is active. Sizes are relative to the
 * surface rather than fixed in pixels, so the panel is genuinely large on a
 * fullscreen display instead of a small dialog marooned in the middle of one.
 *
 * This is the only part of the arena React draws, and it only exists while it
 * is open. During play there is no React in the loop at all.
 */

const ACTION_LABELS: Readonly<Record<ArenaAction, string>> = {
  forward: 'Forward',
  back: 'Back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump',
  crouch: 'Crouch',
  fire: 'Fire',
  zoom: 'Zoom',
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
  readonly onChange: (value: number) => void;
}): ReactNode {
  return (
    <label className="arena-settings__row">
      <span className="arena-settings__label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
      />
      <span className="arena-settings__value">{format(value)}</span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): ReactNode {
  return (
    <label className="arena-settings__row arena-settings__row--toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span className="arena-settings__label">{label}</span>
    </label>
  );
}

export function ArenaSettingsPanel({
  settings,
  onChange,
  onClose,
  touchLayout,
  live,
}: {
  readonly settings: ArenaSettings;
  readonly onChange: (next: ArenaSettings) => void;
  readonly onClose: () => void;
  /** Whether to show the touch group at all. */
  readonly touchLayout: boolean;
  /** Whether the round is already under way behind the panel. */
  readonly live: boolean;
}): ReactNode {
  const [capturing, setCapturing] = useState<ArenaAction | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  /**
   * Rebinding takes the next key pressed, and swallows it.
   *
   * Without swallowing it, the key that was just bound to "jump" also jumps on
   * the way out of the panel.
   */
  useEffect(() => {
    if (capturing === null) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setCapturing(null);
        return;
      }
      const result = bindKey(settings, capturing, event.code);
      if (result.refusedBecauseOf !== null) {
        setRefusal(
          `${labelForCode(event.code)} is already ${ACTION_LABELS[result.refusedBecauseOf].toLowerCase()}.`,
        );
        return;
      }
      setRefusal(null);
      setCapturing(null);
      onChange(result.settings);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [capturing, onChange, settings]);

  const setLook = useCallback(
    (patch: Partial<ArenaSettings['look']>) => {
      onChange({ ...settings, look: { ...settings.look, ...patch } });
    },
    [onChange, settings],
  );

  const setTouch = useCallback(
    (patch: Partial<ArenaSettings['touch']>) => {
      onChange({ ...settings, touch: { ...settings.touch, ...patch } });
    },
    [onChange, settings],
  );

  return (
    <div className="arena-panel arena-settings" role="dialog" aria-label="Arena settings">
      <div className="arena-panel__card arena-settings__panel">
        <header className="arena-settings__header">
          <h2 className="arena-panel__title">Settings</h2>
          <button type="button" className="button button--primary" onClick={onClose}>
            Back to the game
          </button>
        </header>

        {/* Only once there is a round to be shot in. Said plainly rather than
            implied: the opponent is still playing, and a player reading this is
            standing still out there. Before the round opens there is nothing to
            warn about, and a warning that is not true is noise. */}
        {live && (
          <p className="arena-settings__warning" role="status">
            The round is still running. You are standing still out there.
          </p>
        )}

        <section className="arena-settings__group">
          <h3>Look</h3>
          <Slider
            label="Mouse sensitivity"
            value={settings.look.sensitivity}
            min={0.0004}
            max={0.008}
            step={0.0002}
            format={(value) => (value * 1000).toFixed(1)}
            onChange={(sensitivity) => {
              setLook({ sensitivity });
            }}
          />
          <Slider
            label="Zoom sensitivity"
            value={settings.look.zoomSensitivity}
            min={0.2}
            max={1.5}
            step={0.05}
            format={(value) => `${String(Math.round(value * 100))}%`}
            onChange={(zoomSensitivity) => {
              setLook({ zoomSensitivity });
            }}
          />
          <Slider
            label="Field of view"
            value={settings.look.fieldOfView}
            min={0.8}
            max={1.9}
            step={0.05}
            format={(value) => `${String(Math.round((value * 180) / Math.PI))}°`}
            onChange={(fieldOfView) => {
              setLook({ fieldOfView });
            }}
          />
          <Toggle
            label="Invert vertical"
            checked={settings.look.invertY}
            onChange={(invertY) => {
              setLook({ invertY });
            }}
          />
          <Toggle
            label="Invert horizontal"
            checked={settings.look.invertX}
            onChange={(invertX) => {
              setLook({ invertX });
            }}
          />
        </section>

        <section className="arena-settings__group">
          <h3>Keys</h3>
          <p className="hint">
            The mouse buttons always fire and zoom. Keys are stored by position, so a binding made
            on one keyboard layout works on another.
          </p>
          <div className="arena-settings__keys">
            {ARENA_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                className={`arena-settings__key${capturing === action ? ' arena-settings__key--capturing' : ''}`}
                onClick={() => {
                  setRefusal(null);
                  setCapturing(action);
                }}
              >
                <span className="arena-settings__label">{ACTION_LABELS[action]}</span>
                <kbd>{capturing === action ? 'Press a key…' : labelForCode(settings.keys[action])}</kbd>
              </button>
            ))}
          </div>
          {refusal !== null && (
            <p role="alert" className="error">
              {refusal}
            </p>
          )}
        </section>

        {touchLayout && (
          <section className="arena-settings__group">
            <h3>Touch</h3>
            <Slider
              label="Drag sensitivity"
              value={settings.touch.sensitivity}
              min={0.001}
              max={0.02}
              step={0.001}
              format={(value) => (value * 1000).toFixed(0)}
              onChange={(sensitivity) => {
                setTouch({ sensitivity });
              }}
            />
            <Slider
              label="Stick size"
              value={settings.touch.joystickSize}
              min={0.1}
              max={0.3}
              step={0.01}
              format={(value) => `${String(Math.round(value * 100))}%`}
              onChange={(joystickSize) => {
                setTouch({ joystickSize });
              }}
            />
            <Toggle
              label="Invert vertical"
              checked={settings.touch.invertY}
              onChange={(invertY) => {
                setTouch({ invertY });
              }}
            />
            <Toggle
              label="Left-handed layout"
              checked={settings.touch.leftHanded}
              onChange={(leftHanded) => {
                setTouch({ leftHanded });
              }}
            />
          </section>
        )}

        <footer className="arena-settings__footer">
          <p className="hint">
            <kbd>P</kbd> or <kbd>Esc</kbd> to go back. Changes are saved as you make them.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setRefusal(null);
              onChange(DEFAULT_ARENA_SETTINGS);
            }}
          >
            Reset to defaults
          </button>
          <p className="hint">Settings follow your account, not this browser.</p>
        </footer>
      </div>
    </div>
  );
}
