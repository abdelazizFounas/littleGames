import { useEffect, useRef, useState } from 'react';
import {
  botInput,
  createHockey,
  NO_INPUT,
  startHockey,
  step,
  type HockeyInput,
  type HockeySnapshot,
  type HockeyState,
} from '@littlegames/hockey-logic';
import { drawHockey } from './hockey-renderer';
import type { PracticeDifficulty } from '../practice/difficulty';
import '../../styles/hockey.css';
export function HockeyGame({
  snapshot,
  onInput,
  practice = false,
  difficulty = 'easy',
  notice,
}: {
  readonly snapshot?: HockeySnapshot | undefined;
  readonly onInput?: (input: HockeyInput) => void;
  readonly practice?: boolean;
  readonly difficulty?: PracticeDifficulty;
  readonly notice?: string | null;
}) {
  const frame = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    local = useRef(createHockey()),
    remote = useRef(snapshot),
    inputHandler = useRef(onInput);
  remote.current = snapshot;
  inputHandler.current = onInput;
  const [state, setState] = useState(createHockey),
    [paused, setPaused] = useState(practice),
    [fullscreen, setFullscreen] = useState(false);
  const pauseRef = useRef(paused);
  pauseRef.current = paused;
  const held = useRef(new Set<string>()),
    move = useRef({ x: 0, y: 0 }),
    shoot = useRef(false),
    charging = useRef(false),
    shotPointer = useRef<number | null>(null),
    stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const seat = snapshot?.seat ?? 0;
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    const element = canvas.current,
      root = frame.current;
    if (!element || !root) return undefined;
    const ctx = element.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0,
      last = 0,
      accumulator = 0,
      sendAccumulator = 0,
      drawn: HockeyState = createHockey();
    const resize = () => {
      const ratio = Math.min(devicePixelRatio || 1, 2);
      element.width = Math.round(element.clientWidth * ratio);
      element.height = Math.round(element.clientHeight * ratio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const release = () => {
      held.current.clear();
      move.current = { x: 0, y: 0 };
      shoot.current = false;
      charging.current = false;
      shotPointer.current = null;
      stick.current = null;
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        !root.contains(document.activeElement) ||
        (event.target instanceof HTMLElement && event.target.closest('button,input,select'))
      )
        return;
      if (event.code === 'Escape' && practice) {
        setPaused((value) => !value);
        release();
        return;
      }
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'KeyZ',
          'KeyQ',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Space',
        ].includes(event.code)
      ) {
        event.preventDefault();
        held.current.add(event.code);
        if (event.code === 'Space' && !event.repeat && !pauseRef.current) charging.current = true;
      }
    };
    const keyup = (event: KeyboardEvent) => {
      held.current.delete(event.code);
      if (event.code === 'Space' && charging.current) {
        charging.current = false;
        if (!pauseRef.current) shoot.current = true;
      }
    };
    const blur = () => {
      release();
      if (practice) setPaused(true);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    const hidden = () => {
      if (document.hidden) blur();
    };
    document.addEventListener('visibilitychange', hidden);
    function sample(): HockeyInput {
      if (pauseRef.current) return NO_INPUT;
      const keys = held.current;
      return {
        x:
          move.current.x +
          (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
          (keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft') ? 1 : 0),
        y:
          move.current.y +
          (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) -
          (keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp') ? 1 : 0),
        shoot: shoot.current,
        charging: charging.current,
      };
    }
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const elapsed = last ? Math.min(100, now - last) : 0;
      last = now;
      if (practice) {
        if (!pauseRef.current) {
          accumulator += elapsed;
          while (accumulator >= 1000 / 60) {
            accumulator -= 1000 / 60;
            const input = sample();
            shoot.current = false;
            local.current = step(local.current, [input, botInput(local.current, 1, difficulty)]);
            if (local.current.phase === 'finished') break;
          }
        }
        drawn = local.current;
        if (local.current.phase !== 'playing' || local.current.tick % 6 === 0)
          setState(local.current);
      } else if (remote.current) {
        const target = remote.current.state;
        sendAccumulator += elapsed;
        if (sendAccumulator >= 1000 / 30) {
          sendAccumulator %= 1000 / 30;
          const input = sample();
          shoot.current = false;
          inputHandler.current?.(input);
        }
        const snap = target.phase !== 'playing' || Math.abs(target.tick - drawn.tick) > 20;
        drawn = {
          ...target,
          players: target.players.map((p, i) => {
            const old = drawn.players[i];
            return old && !snap
              ? { ...p, x: old.x + (p.x - old.x) * 0.48, y: old.y + (p.y - old.y) * 0.48 }
              : p;
          }),
          puck: snap
            ? target.puck
            : {
                ...target.puck,
                x: drawn.puck.x + (target.puck.x - drawn.puck.x) * 0.6,
                y: drawn.puck.y + (target.puck.y - drawn.puck.y) * 0.6,
              },
        };
        setState(target);
      }
      drawHockey(ctx, drawn, remote.current?.seat ?? 0, element.width, element.height);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      release();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [practice, difficulty]);
  const finished = state.phase === 'finished';
  function start() {
    if (local.current.phase === 'waiting' || finished) local.current = startHockey(createHockey());
    setPaused(false);
    pauseRef.current = false;
    frame.current?.focus();
  }
  return (
    <div className="hockey-game" ref={frame} tabIndex={0}>
      <header className="hockey-header">
        <div>
          <p className="eyebrow">ICE CLASH / FROZEN RIVALRIES</p>
          <h2>Leave it all on the ice.</h2>
        </div>
        <div className="actions">
          {practice && (
            <button
              className="button"
              onClick={() => {
                setPaused(true);
                held.current.clear();
                move.current = { x: 0, y: 0 };
                stick.current = null;
                shoot.current = false;
                charging.current = false;
                shotPointer.current = null;
              }}
            >
              Pause
            </button>
          )}
          <button
            className="button"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={() => {
              const change = fullscreen
                ? document.exitFullscreen()
                : frame.current?.requestFullscreen?.();
              void change?.catch(() => undefined);
            }}
          >
            ⛶
          </button>
        </div>
      </header>
      <div className="hockey-score">
        <div>
          <span>{snapshot?.names[seat] ?? 'You'}</span>
          <strong>{state.scores[seat]}</strong>
        </div>
        <p>
          FIRST TO <b>5</b>
          <small>{practice ? 'PRACTICE' : 'LIVE DUEL'}</small>
        </p>
        <div>
          <strong>{state.scores[1 - seat]}</strong>
          <span>
            {snapshot?.names[1 - seat] ??
              `${difficulty === 'extra-hard' ? 'Extra Hard' : difficulty === 'hard' ? 'Hard' : 'Easy'} bot`}
          </span>
        </div>
      </div>
      <div className="hockey-rink">
        <canvas
          ref={canvas}
          aria-label="Ice hockey rink"
          onPointerDown={() => frame.current?.focus()}
        />
        {(paused || finished) && practice && (
          <div className="hockey-overlay">
            <p className="eyebrow">SKATE. STEAL. SCORE.</p>
            <h3>
              {finished
                ? state.winner === 0
                  ? 'You own this ice.'
                  : 'One more rivalry?'
                : state.phase === 'waiting'
                  ? 'A little ice. A lot of rivalry.'
                  : 'The rink can wait.'}
            </h3>
            <p>
              Skate with WASD, ZQSD, or arrows. Hold Space or Strike to charge for up to 1.5s;
              release to shoot or knock a nearby rival. Steal from the puck side, not through their
              back.
            </p>
            <button className="button button--primary" onClick={start}>
              {finished ? 'Play again' : state.phase === 'waiting' ? 'Let’s play' : 'Resume game'}{' '}
              ↗
            </button>
          </div>
        )}
        {!practice && (finished || !snapshot?.connected.every(Boolean)) && (
          <div className="hockey-overlay">
            <h3>
              {finished
                ? state.winner === seat
                  ? 'You win the clash.'
                  : 'Your rival takes the ice.'
                : 'Waiting for your rival…'}
            </h3>
            <p>
              {finished
                ? 'First to five. A rivalry worth repeating.'
                : 'Reconnecting players keep their score. The match pauses for up to 60 seconds.'}
            </p>
          </div>
        )}
        <div className="hockey-touch">
          <div
            className="hockey-stick"
            aria-label="Movement joystick"
            onPointerDown={(event) => {
              if (stick.current || paused || finished) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              stick.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
            }}
            onPointerMove={(event) => {
              const origin = stick.current;
              if (!origin || origin.id !== event.pointerId) return;
              const x = (event.clientX - origin.x) / 42,
                y = (event.clientY - origin.y) / 42,
                length = Math.max(1, Math.hypot(x, y));
              move.current = { x: x / length, y: y / length };
              event.currentTarget.style.setProperty('--stick-x', `${(x / length) * 18}px`);
              event.currentTarget.style.setProperty('--stick-y', `${(y / length) * 18}px`);
            }}
            onPointerUp={(event) => {
              if (stick.current?.id === event.pointerId) {
                event.currentTarget.style.setProperty('--stick-x', '0px');
                event.currentTarget.style.setProperty('--stick-y', '0px');
                stick.current = null;
                move.current = { x: 0, y: 0 };
              }
            }}
            onPointerCancel={(event) => {
              if (stick.current?.id !== event.pointerId) return;
              stick.current = null;
              move.current = { x: 0, y: 0 };
              event.currentTarget.style.setProperty('--stick-x', '0px');
              event.currentTarget.style.setProperty('--stick-y', '0px');
            }}
            onLostPointerCapture={(event) => {
              if (stick.current?.id !== event.pointerId) return;
              stick.current = null;
              move.current = { x: 0, y: 0 };
              event.currentTarget.style.setProperty('--stick-x', '0px');
              event.currentTarget.style.setProperty('--stick-y', '0px');
            }}
          >
            <span>✥</span>
            <small>DRAG TO SKATE</small>
          </div>
          <p>
            Carry the puck.
            <br />
            Find the corner.
          </p>
          <button
            className="hockey-shoot"
            aria-label="Hold to charge, release to strike"
            data-charging={charging.current}
            style={{
              background: `conic-gradient(from 180deg, #ffd49755 ${(state.players[seat]?.charge ?? 0) * 360}deg, #193a4d44 0deg)`,
            }}
            disabled={paused || finished}
            onPointerDown={(event) => {
              event.preventDefault();
              if (shotPointer.current !== null) return;
              shotPointer.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              charging.current = true;
            }}
            onPointerUp={(event) => {
              if (shotPointer.current !== event.pointerId) return;
              shotPointer.current = null;
              charging.current = false;
              if (!paused && !finished) shoot.current = true;
            }}
            onPointerCancel={(event) => {
              if (shotPointer.current === event.pointerId) {
                shotPointer.current = null;
                charging.current = false;
              }
            }}
            onLostPointerCapture={(event) => {
              if (shotPointer.current === event.pointerId) {
                shotPointer.current = null;
                charging.current = false;
              }
            }}
          >
            STRIKE <span>↗</span>
            <small>HOLD · RELEASE</small>
          </button>
        </div>
      </div>
      <div
        className="hockey-charge"
        role="progressbar"
        aria-label="Shot power"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((state.players[seat]?.charge ?? 0) * 100)}
      >
        <span>
          HOLD TO CHARGE <b>{Math.round((state.players[seat]?.charge ?? 0) * 100)}%</b>
        </span>
        <i style={{ width: `${(state.players[seat]?.charge ?? 0) * 100}%` }} />
      </div>
      <footer className="hockey-footer">
        <span>
          {notice ??
            (state.puck.owner === seat
              ? 'YOU HAVE THE PUCK · FIND YOUR SHOT'
              : state.puck.owner === 1 - seat
                ? 'CLOSE THE GAP · SKATE IN TO STEAL'
                : 'LOOSE PUCK · GET THERE FIRST')}
        </span>
        {practice && (
          <button
            className="link-button"
            onClick={() => {
              local.current = createHockey();
              setState(local.current);
              setPaused(true);
              charging.current = false;
              shoot.current = false;
              move.current = { x: 0, y: 0 };
              stick.current = null;
              shotPointer.current = null;
            }}
          >
            Restart
          </button>
        )}
      </footer>
    </div>
  );
}
