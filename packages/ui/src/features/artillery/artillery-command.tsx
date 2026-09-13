import { useEffect, useRef, useState } from 'react';
import {
  MAPS,
  WEAPONS,
  type Action,
  type ArtilleryState,
  type Options,
  type Shot,
  type Weapon,
} from '@littlegames/artillery-logic';
import { useArtilleryAudio } from './artillery-audio';
import { Battlefield, THEMES } from './battlefield';
import '../../styles/artillery.css';

export function ArtilleryCommand({
  state: source,
  seat = 0,
  names = ['You', 'Practice bot'],
  connected = [true, true],
  remainingSeconds,
  practice = false,
  blocked = false,
  notice,
  onAction,
  onRestart,
  onBusyChange,
}: {
  readonly state: ArtilleryState;
  readonly seat?: number;
  readonly names?: readonly string[];
  readonly connected?: readonly boolean[];
  readonly remainingSeconds?: number;
  readonly practice?: boolean;
  readonly blocked?: boolean;
  readonly notice?: string | null;
  readonly onAction: (action: Action) => void;
  readonly onRestart?: () => void;
  readonly onBusyChange?: (busy: boolean) => void;
}) {
  const audio = useArtilleryAudio();
  const sound = useRef(audio.play); sound.current = audio.play;
  const frame = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(source);
  const previous = useRef(source);
  const [shot, setShot] = useState<Shot | null>(null);
  const [impact, setImpact] = useState(false);
  const [angle, setAngle] = useState(seat === 0 ? 45 : 135);
  const [power, setPower] = useState(75);
  const [weapon, setWeapon] = useState<Weapon>('shell');
  const [guide, setGuide] = useState(true);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => { if (shot) sound.current(impact); }, [shot?.id, impact]);
  const busy = !!shot || paused;
  const latest = useRef(source);
  latest.current = source;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    const old = previous.current;
    if (source.revision === old.revision) return undefined;
    previous.current = source;
    const incoming = source.lastShot;
    if (incoming && incoming.id !== old.lastShot?.id && old.phase === 'playing') {
      setShot(incoming);
      setImpact(false);
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const land = setTimeout(
        () => {
          setImpact(true);
          setState(source);
        },
        reduced ? 0 : 1300,
      );
      const finish = setTimeout(
        () => {
          setShot(null);
          setImpact(false);
          setState(latest.current);
        },
        reduced ? 20 : 2050,
      );
      return () => {
        clearTimeout(land);
        clearTimeout(finish);
      };
    }
    setState(source);
    return undefined;
  }, [source.revision]);
  useEffect(() => {
    setAngle(seat === 0 ? 45 : 135);
  }, [seat]);
  useEffect(() => {
    setWeapon('shell');
  }, [state.round]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden && practice) setPaused(true);
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [practice]);
  const mine = state.tanks[seat];
  const canPlay =
    state.phase === 'playing' &&
    state.turn === seat &&
    !blocked &&
    !busy &&
    connected.every(Boolean);
  const canConfigure = state.phase === 'setup' && seat === 0 && !blocked;
  function configure(patch: Partial<Options>) {
    onAction({ type: 'configure', options: { ...state.options, ...patch } });
  }
  function fire() {
    audio.activate();
    if (canPlay) onAction({ type: 'fire', angle, power, weapon });
  }
  const title = paused
    ? 'Take a breather.'
    : shot
      ? impact
        ? 'Impact confirmed.'
        : 'Watch that arc.'
      : state.phase === 'setup'
        ? 'Small tanks. Big ambitions.'
        : state.phase === 'finished'
          ? state.winner === seat
            ? 'The horizon is yours.'
            : 'A duel worth a rematch.'
          : state.phase === 'round-over'
            ? state.winner < 0
              ? 'An even exchange.'
              : state.winner === seat
                ? 'One round closer.'
                : 'Regroup. Recalibrate.'
            : state.turn === seat
              ? 'Make every degree count.'
              : 'Your rival is lining up.';
  return (
    <div
      className="artillery-command"
      ref={frame}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest('input,select,button'))
          return;
        if (event.key === 'Escape' && practice) setPaused((value) => !value);
        if (!canPlay) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          setAngle((value) =>
            Math.max(5, Math.min(175, value + (event.key === 'ArrowRight' ? 1 : -1))),
          );
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          setPower((value) =>
            Math.max(10, Math.min(100, value + (event.key === 'ArrowUp' ? 1 : -1))),
          );
        }
        if (event.code === 'Space') {
          event.preventDefault();
          fire();
        }
      }}
      tabIndex={0}
    >
      <header className="artillery-header">
        <div>
          <p className="artillery-kicker">POCKET ARTILLERY / FIELD OPERATIONS</p>
          <h2>{title}</h2>
        </div>
        <div className="artillery-tools">
          <button className="button" aria-label={audio.enabled ? 'Mute sound' : 'Enable sound'} aria-pressed={audio.enabled} onClick={audio.toggle}>♪</button>
          <button
            className="button"
            aria-label="How to play Pocket Artillery"
            onClick={() => setHelp((value) => !value)}
          >
            ?
          </button>
          {practice && (
            <button className="button" onClick={() => setPaused((value) => !value)}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
          <button
            className="button"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={() => {
              const change = fullscreen
                ? document.exitFullscreen()
                : frame.current?.requestFullscreen?.();
              void change?.catch(() => setHelp(true));
            }}
          >
            {fullscreen ? '↙' : '⛶'}
          </button>
        </div>
      </header>
      {help && (
        <div className="artillery-help">
          <strong>Arc it. Land it. Win it.</strong>
          <p>
            Set your angle and power, read the wind, then fire. Hits end your turn. Heavy rockets
            hit harder; scatter shells cover more ground. A shield halves the next damaging hit and
            costs a turn. Win {Math.ceil(state.options.bestOf / 2)} rounds to take the match. Arrow
            keys adjust aim; Space fires when the battlefield is focused.
          </p>
          <p>
            Online turns have a timer. A lost connection pauses the duel for up to 60 seconds.
            Practice pauses locally.
          </p>
          <button className="link-button" onClick={() => setHelp(false)}>
            Close guide
          </button>
        </div>
      )}
      <div className="artillery-scoreboard">
        {[0, 1].map((player) => (
          <div
            className={`artillery-player${player === seat ? ' artillery-player--you' : ''}${state.turn === player ? ' artillery-player--active' : ''}`}
            key={player}
          >
            <div>
              <span>{player === seat ? 'YOUR BATTERY' : 'RIVAL BATTERY'}</span>
              <strong>{names[player]}</strong>
            </div>
            <b>
              {state.scores[player]}
              <small> ROUNDS</small>
            </b>
            <div
              className="artillery-health"
              role="meter"
              aria-label={`${player === seat ? 'Your' : 'Rival'} armor`}
              aria-valuemin={0}
              aria-valuemax={state.options.health}
              aria-valuenow={state.tanks[player]?.health ?? 0}
            >
              <i
                style={{
                  width: `${((state.tanks[player]?.health ?? 0) / state.options.health) * 100}%`,
                }}
              />
            </div>
            <small>
              {state.tanks[player]?.health} / {state.options.health} ARMOR
              {state.tanks[player]?.shield ? ' · SHIELDED' : ''}
            </small>
          </div>
        ))}
      </div>
      <div className="artillery-field">
        <Battlefield
          state={state}
          seat={seat}
          angle={angle}
          power={power}
          shot={shot}
          impact={impact}
          guide={guide}
        />
        <div className="artillery-field-meta">
          <span>
            ROUND {state.round} · BEST OF {state.options.bestOf}
          </span>
          <span>
            WIND {state.wind < 0 ? '←' : '→'} {Math.abs(state.wind)}{' '}
            {state.wind === 0 ? '· CALM' : ''}
          </span>
          <span>
            {practice ? 'PRACTICE' : `${remainingSeconds ?? state.options.turnSeconds}s / TURN`}
          </span>
        </div>
        {paused && (
          <div className="artillery-pause">
            <strong>Your next great shot can wait.</strong>
            <button className="button button--primary" onClick={() => setPaused(false)}>
              Resume battle
            </button>
          </div>
        )}
      </div>
      <div className="artillery-transmission" role="status">
        {notice ||
          (!connected.every(Boolean)
            ? 'Waiting for your rival. Reconnecting players keep their tank and score.'
            : shot
              ? impact
                ? `${shot.damage[1 - shot.player] ?? 0} damage to the rival battery${(shot.damage[shot.player] ?? 0) > 0 ? ' · Self-damage received' : ''}.`
                : `${WEAPONS[shot.weapon].name} away · ${Math.round(shot.angle)}° · ${Math.round(shot.power)}% power`
              : state.phase === 'playing'
                ? canPlay
                  ? 'Your turn. The dotted line shows your launch direction.'
                  : 'Watch the wind. Your next opening is coming.'
                : 'Choose your battlefield and match rules. Both commanders must be ready.')}
      </div>
      {state.phase === 'setup' && (
        <section className="artillery-setup">
          <div className="artillery-section-title">
            <h3>Choose your horizon</h3>
            <span>
              {practice
                ? 'YOUR MATCH. YOUR RULES.'
                : seat === 0
                  ? 'HOST CONTROLS'
                  : 'HOST SELECTS THE RULES'}
            </span>
          </div>
          <div className="artillery-map-options">
            {MAPS.map((map) => (
              <button
                key={map}
                disabled={!canConfigure}
                aria-pressed={state.options.map === map}
                className={`artillery-map artillery-map--${map}`}
                onClick={() => configure({ map })}
              >
                <span className="artillery-map__sun" />
                <strong>{THEMES[map].name}</strong>
                <small>{THEMES[map].subtitle}</small>
                <b>{state.options.map === map ? 'SELECTED' : 'EXPLORE ↗'}</b>
              </button>
            ))}
          </div>
          <div className="artillery-options">
            {(
              [
                {
                  key: 'bestOf',
                  label: 'Match length',
                  values: [1, 3, 5],
                  labels: ['Single round', 'Best of 3', 'Best of 5'],
                },
                {
                  key: 'health',
                  label: 'Tank armor',
                  values: [100, 150],
                  labels: ['Standard · 100', 'Reinforced · 150'],
                },
                {
                  key: 'wind',
                  label: 'Wind conditions',
                  values: [0, 1, 2],
                  labels: ['Calm', 'Breezy', 'Strong'],
                },
                {
                  key: 'turnSeconds',
                  label: 'Online turn timer',
                  values: [20, 30, 45],
                  labels: ['20 seconds', '30 seconds', '45 seconds'],
                },
              ] as const
            ).map((option) => (
              <label key={option.key}>
                {option.label}
                <select
                  disabled={!canConfigure}
                  aria-label={option.label}
                  value={state.options[option.key]}
                  onChange={(event) => configure({ [option.key]: Number(event.target.value) })}
                >
                  {option.values.map((value, index) => (
                    <option value={value} key={value}>
                      {option.labels[index]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}
      {state.phase === 'playing' && (
        <div className="artillery-controls">
          <div className="artillery-aim">
            <label>
              <span>
                ELEVATION <b>{Math.round(angle)}°</b>
              </span>
              <input
                aria-label="Firing angle"
                type="range"
                min="5"
                max="175"
                step="1"
                value={angle}
                disabled={!canPlay}
                onChange={(event) => setAngle(Number(event.target.value))}
              />
              <small>← Fire right · Fire left →</small>
            </label>
            <label>
              <span>
                FIREPOWER <b>{Math.round(power)}%</b>
              </span>
              <input
                aria-label="Shot power"
                type="range"
                min="10"
                max="100"
                step="1"
                value={power}
                disabled={!canPlay}
                onChange={(event) => setPower(Number(event.target.value))}
              />
              <small>Short lob · Long-range strike</small>
            </label>
          </div>
          <div className="artillery-loadout">
            {(['shell', 'heavy', 'scatter'] as const).map((item) => (
              <button
                key={item}
                className={weapon === item ? 'is-selected' : ''}
                aria-pressed={weapon === item}
                disabled={!canPlay || (item !== 'shell' && (mine?.[item] ?? 0) <= 0)}
                onClick={() => setWeapon(item)}
              >
                <span>{item === 'shell' ? '↗' : item === 'heavy' ? '◆' : '✣'}</span>
                <strong>{WEAPONS[item].name}</strong>
                <small>{item === 'shell' ? 'Unlimited' : `${mine?.[item]} remaining`}</small>
              </button>
            ))}
          </div>
          <div className="artillery-trigger">
            <button
              className="button artillery-fire"
              disabled={!canPlay || (weapon !== 'shell' && (mine?.[weapon] ?? 0) <= 0)}
              onClick={fire}
            >
              Fire {weapon === 'shell' ? 'shell' : weapon === 'heavy' ? 'rocket' : 'scatter'}{' '}
              <span>↗</span>
            </button>
            <button
              className="button"
              disabled={!canPlay || mine?.shieldUsed}
              onClick={() => onAction({ type: 'shield' })}
            >
              {mine?.shieldUsed ? 'Shield used' : 'Raise shield · Uses turn'}
            </button>
          </div>
        </div>
      )}
      {(state.phase === 'setup' || state.phase === 'round-over') && (
        <div className="artillery-ready">
          <p>
            {state.phase === 'round-over'
              ? `Round ${state.round} complete. The opening turn alternates each round.`
              : state.ready[1 - seat]
                ? 'Your rival is ready. Take your position.'
                : 'A perfect shot starts with a little preparation.'}
          </p>
          <button
            className="button artillery-fire"
            disabled={blocked || busy || state.ready[seat]}
            onClick={() => { audio.activate(); onAction({ type: 'ready' }); }}
          >
            {state.ready[seat]
              ? 'Waiting for your rival…'
              : state.phase === 'round-over'
                ? 'Next round →'
                : practice
                  ? 'Start battle →'
                  : 'Ready to fire →'}
          </button>
        </div>
      )}
      <footer className="artillery-footer">
        <label>
          <input
            type="checkbox"
            checked={guide}
            onChange={(event) => setGuide(event.target.checked)}
          />{' '}
          Show launch guide
        </label>
        <span>
          {THEMES[state.options.map].name} ·{' '}
          {state.options.map === 'moon' ? 'LOW GRAVITY' : 'STANDARD GRAVITY'}
        </span>
        {onRestart && (
          <button className="link-button" onClick={onRestart}>
            {state.phase === 'finished' ? 'Play again →' : 'New practice match'}
          </button>
        )}
      </footer>
    </div>
  );
}
