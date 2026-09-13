import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { GAMES } from '../features/catalog/games';
import { ArenaSettingsPanel } from '../features/game/arena-settings-panel';
import {
  loadLocalArenaSettings,
  saveLocalArenaSettings,
  hasCoarsePointer,
} from '../features/game/arena-settings';
import { ArtilleryPractice } from '../features/artillery/artillery-practice';
import { FleetPractice } from '../features/practice/fleet-practice';
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  practiceDifficulty,
  type PracticeDifficulty,
} from '../features/practice/difficulty';
import type { PracticeSession } from '../features/practice/practice-session';
import { describeError } from '../lib/describe-error';

export function PracticeRoute() {
  const { gameId } = useParams();
  const [params, setParams] = useSearchParams();
  const [difficulty, setDifficulty] = useState(() => practiceDifficulty(params.get('difficulty')));
  useEffect(() => setDifficulty(practiceDifficulty(params.get('difficulty'))), [params]);
  const game = GAMES.find((candidate) => candidate.id === gameId);
  if (!game)
    return (
      <section className="panel">
        <h1>Choose your warm-up.</h1>
        <p className="lede">Practice every game against a bot, at your own pace.</p>
        {GAMES.map((item) => (
          <Link key={item.id} className="text-link" to={`/practice/${item.id}`}>
            Practice {item.name} →
          </Link>
        ))}
      </section>
    );
  const descriptions =
    game.id === 'artillery'
      ? [
          'Room to learn the arc.',
          'Accurate shots. Smarter weapons.',
          'Precise ballistics. Little mercy.',
        ]
      : game.id === 'battleship'
        ? [
            'A relaxed, random search.',
            'Hunts for ships and follows hits.',
            'Maps likely ship positions.',
          ]
        : game.id === 'arena'
          ? [
              'Slower reactions. Room to learn.',
              'Faster movement and sharper aim.',
              'Precise aim. Relentless pressure.',
            ]
          : [
              'Forgiving rallies. Time to react.',
              'Predicts bounces and returns faster.',
              'Quick reactions and precise returns.',
            ];
  return (
    <section className="practice-page">
      <div className="practice-heading">
        <div>
          <p className="eyebrow">
            <span className="status-dot" /> SOLO PRACTICE · NO ACCOUNT NEEDED
          </p>
          <h1>
            {game.name}
            <span className="lime">.</span>
          </h1>
        </div>
        <Link className="button" to={`/games/${game.id}`}>
          Ready for a real rival? ↗
        </Link>
      </div>
      <fieldset className="practice-difficulty">
        <legend>Choose your challenge</legend>
        <div className="practice-difficulty__options">
          {DIFFICULTIES.map((level, index) => (
            <label
              className={`difficulty-card${difficulty === level ? ' difficulty-card--selected' : ''}`}
              key={level}
            >
              <input
                type="radio"
                name="difficulty"
                value={level}
                checked={difficulty === level}
                onChange={() => {
                  setDifficulty(level);
                  const next = new URLSearchParams(params);
                  next.set('difficulty', level);
                  setParams(next, { replace: true });
                }}
              />
              <span className="difficulty-card__icon" aria-hidden="true">
                {index === 0 ? '◒' : index === 1 ? '◆' : '✦'}
              </span>
              <span>
                <strong>{DIFFICULTY_LABELS[level]}</strong>
                <small>{descriptions[index]}</small>
              </span>
              <span className="difficulty-card__check" aria-hidden="true">
                {difficulty === level ? '●' : '○'}
              </span>
            </label>
          ))}
        </div>
        <p className="hint">
          Changing difficulty starts a fresh round. Practice results stay on this device.
        </p>
      </fieldset>
      {game.id === 'artillery' ? (
        <ArtilleryPractice key={`${game.id}:${difficulty}`} difficulty={difficulty} />
      ) : game.id === 'battleship' ? (
        <FleetPractice key={`${game.id}:${difficulty}`} difficulty={difficulty} />
      ) : (
        <PracticeGame key={`${game.id}:${difficulty}`} gameId={game.id} difficulty={difficulty} />
      )}
      <nav className="practice-other-games" aria-label="Other practice games">
        {GAMES.filter((item) => item.id !== game.id).map((item) => (
          <Link
            key={item.id}
            className="text-link"
            to={`/practice/${item.id}?difficulty=${difficulty}`}
          >
            Try {item.name} practice →
          </Link>
        ))}
      </nav>
    </section>
  );
}
function PracticeGame({
  gameId,
  difficulty,
}: {
  readonly gameId: 'arena' | 'pong';
  readonly difficulty: PracticeDifficulty;
}) {
  const [settings, setSettings] = useState(loadLocalArenaSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const returnStatus = useRef<'ready' | 'playing' | 'paused' | 'finished'>('ready');
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const session = useRef<PracticeSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'playing' | 'paused' | 'finished'>(
    'loading',
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let current: PracticeSession | null = null;
    setStatus('loading');
    setError(null);
    async function mount() {
      const module =
        gameId === 'arena'
          ? await import('../features/practice/arena-practice')
          : await import('../features/practice/pong-practice');
      if (cancelled || !container.current) return;
      current = await module.createPractice(
        container.current,
        {
          onSettings: () => {
            if (!cancelled) {
              returnStatus.current = 'playing';
              setStatus('paused');
              setSettingsOpen(true);
            }
          },
          onPause: () => {
            if (!cancelled) setStatus('paused');
          },
          onFinish: (message) => {
            if (!cancelled) {
              setResult(message);
              setStatus('finished');
            }
          },
          onError: (message) => {
            if (!cancelled) {
              setError(message);
              setStatus('paused');
            }
          },
        },
        difficulty,
      );
      if (cancelled) {
        current.stop();
        return;
      }
      current.updateSettings?.(settingsRef.current);
      session.current = current;
      setStatus('ready');
    }
    void mount().catch((cause) => {
      if (!cancelled)
        setError(
          describeError(
            cause,
            'The game could not start. Please check WebGL support in your browser.',
          ),
        );
    });
    return () => {
      cancelled = true;
      current?.stop();
      session.current = null;
    };
  }, [gameId, attempt, difficulty]);
  function start(restart = false) {
    setError(null);
    if (restart || status === 'finished') session.current?.restart();
    session.current?.start();
    setStatus('playing');
  }
  return (
    <>
      <p className="hint">
        {gameId === 'arena'
          ? 'Warm up against a moving bot. First to 7 eliminations wins. Right-click for precise scoped shots.'
          : 'You’re the green paddle on the left. Beat the bot to 11 points.'}
      </p>
      <div ref={frame} className="practice-frame">
        <div
          ref={container}
          inert={settingsOpen || status !== 'playing'}
          className={`stage__surface${gameId === 'arena' ? ' stage__surface--arena' : ''}`}
        />
        {gameId === 'arena' && !settingsOpen && (
          <button
            className="button arena-settings-launch"
            disabled={status === 'loading'}
            onClick={() => {
              returnStatus.current = status === 'loading' ? 'ready' : status;
              session.current?.pause();
              setSettingsOpen(true);
            }}
          >
            Settings ⚙
          </button>
        )}
        {settingsOpen && (
          <ArenaSettingsPanel
            settings={settings}
            touchLayout={hasCoarsePointer()}
            live={false}
            onChange={(next) => {
              setSettings(next);
              saveLocalArenaSettings(next);
              session.current?.updateSettings?.(next);
            }}
            onClose={() => {
              setSettingsOpen(false);
              if (returnStatus.current === 'playing') start();
              else setStatus(returnStatus.current);
            }}
          />
        )}
        {status !== 'playing' && !settingsOpen && (
          <div className="practice-overlay">
            <p className="eyebrow">A LITTLE PRACTICE GOES A LONG WAY</p>
            <h2>
              {error && status === 'loading'
                ? 'Let’s try that again.'
                : status === 'loading'
                  ? 'Building your playground…'
                  : status === 'finished'
                    ? result
                    : status === 'paused'
                      ? 'Take a breather.'
                      : 'Meet your practice rival.'}
            </h2>
            <p>
              {gameId === 'arena'
                ? 'WASD to move · Mouse to aim · Click to fire · Right-click to scope · Shift to crouch'
                : 'Arrow keys or W / S to move. On touchscreens, drag on the court.'}
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {status !== 'loading' ? (
              <button className="button button--primary" onClick={() => start()}>
                {status === 'paused'
                  ? 'Resume game'
                  : status === 'finished'
                    ? 'Play again'
                    : 'Let’s play'}{' '}
                ↗
              </button>
            ) : (
              error && (
                <button className="button" onClick={() => setAttempt((value) => value + 1)}>
                  Retry
                </button>
              )
            )}
          </div>
        )}
        <button
          className="button practice-fullscreen-exit"
          onClick={() => {
            void document.exitFullscreen().catch(() => {
              session.current?.pause();
            });
          }}
        >
          Exit fullscreen ⛶
        </button>
      </div>
      <div className="practice-toolbar">
        <span>
          {gameId === 'arena'
            ? 'WASD · MOUSE · SPACE TO JUMP · ESC TO PAUSE'
            : '↑ ↓ TO MOVE · ESC TO PAUSE'}{' '}
          · PRACTICE SCORES STAY LOCAL
        </span>
        <div className="actions">
          <button
            className="button"
            disabled={status === 'loading'}
            onClick={() => session.current?.pause()}
          >
            Pause
          </button>
          <button
            className="button"
            disabled={status === 'loading'}
            onClick={() => {
              session.current?.pause();
              session.current?.restart();
              setStatus('ready');
            }}
          >
            Restart
          </button>
          <button
            className="button"
            onClick={() => {
              const target = frame.current;
              if (!target) return;
              const change = document.fullscreenElement
                ? document.exitFullscreen()
                : target.requestFullscreen?.();
              void change?.catch(() => {
                setError('Fullscreen is unavailable. You can keep playing in this window.');
                session.current?.pause();
              });
            }}
          >
            Fullscreen ⛶
          </button>
        </div>
      </div>
    </>
  );
}
