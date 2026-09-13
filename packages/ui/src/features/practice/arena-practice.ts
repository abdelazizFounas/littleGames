import {
  aimFromWire,
  createInitialState,
  eyePosition,
  MAX_HEALTH,
  moveFromWire,
  normalizeAim,
  NO_INPUT,
  startCountdown,
  step,
  TICK_RATE,
  type ArenaState,
} from '@littlegames/arena-logic';
import { createArenaBabylonRenderer } from '@littlegames/arena-renderer-babylon';
import { createArenaInput } from '../game/arena-input-sources';
import {
  DEFAULT_ARENA_SETTINGS,
  SCOPE_MAGNIFICATION,
  SCOPE_RAISE_MS,
} from '../game/arena-settings';
import {
  drawableShots,
  fadeSince,
  viewModelMuzzle,
  viewModelOf,
  type TimedShot,
} from '../game/arena-view';
import { BOT_SETTINGS, type PracticeDifficulty } from './difficulty';
import type { PracticeListeners, PracticeSession } from './practice-session';

export async function createPractice(
  container: HTMLElement,
  listeners: PracticeListeners,
  difficulty: PracticeDifficulty = 'easy',
): Promise<PracticeSession> {
  const renderer = createArenaBabylonRenderer();
  try {
    await renderer.mount(container);
  } catch (cause) {
    renderer.destroy();
    throw cause;
  }
  if (!renderer.canvas) {
    renderer.destroy();
    throw new Error('Could not create the arena.');
  }
  let state: ArenaState = startCountdown(createInitialState(), TICK_RATE * 3);
  const bot = BOT_SETTINGS[difficulty];
  let botAim = normalizeAim({ x: 0, y: 0, z: -1 });
  let active = false;
  let stopped = false;
  let frame = 0;
  let lastAt = 0;
  let accumulator = 0;
  let seq = 0;
  let shotsAcked = 0;
  let scope = 0;
  let hitAt: number | null = null;
  let damageAt: number | null = null;
  let shots: TimedShot[] = [];
  const input = createArenaInput(renderer.canvas, container, {
    onLockRefused: (reason) => {
      active = false;
      listeners.onError(`Mouse capture was refused: ${reason}`);
    },
    onLockChange: (locked) => {
      if (!locked && active) {
        active = false;
        listeners.onPause();
      }
    },
    onOpenSettings: () => {
      active = false;
      input.releaseLock();
      listeners.onPause();
    },
  });
  input.start();
  input.faceSeat('north');
  const resize = () => renderer.resize(container.clientWidth, container.clientHeight);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  function draw(now: number) {
    if (stopped) return;
    frame = requestAnimationFrame(draw);
    const elapsed = lastAt ? Math.min(now - lastAt, 100) : 0;
    lastAt = now;
    if (active) {
      input.advance(elapsed / 1000);
      accumulator += elapsed;
      while (accumulator >= 1000 / TICK_RATE) {
        accumulator -= 1000 / TICK_RATE;
        const command = input.sample(++seq);
        const fire = command.shotsFired > shotsAcked;
        shotsAcked = command.shotsFired;
        const targetX =
          difficulty === 'easy'
            ? Math.sin(state.tick / 170) * 6
            : Math.max(-9, Math.min(9, state.north.body.x + Math.sin(state.tick / 65) * 4));
        const enemyEye = eyePosition(state.south.body);
        const ownEye = eyePosition(state.north.body);
        if (state.tick % bot.arenaReaction === 0)
          botAim = normalizeAim({
            x: ownEye.x - enemyEye.x + Math.sin(state.tick * 0.17) * bot.arenaError,
            y: ownEye.y - enemyEye.y - 0.3 + Math.cos(state.tick * 0.11) * bot.arenaError * 0.5,
            z: ownEye.z - enemyEye.z,
          });
        const outcome = step(state, {
          north: {
            move: moveFromWire(command.moveX, command.moveZ),
            aim: aimFromWire(command.aimX, command.aimY, command.aimZ),
            jump: command.jump,
            crouch: command.crouch,
            zoomed: command.zoomed,
            fire,
            rewindTicks: 0,
          },
          south: {
            ...NO_INPUT,
            move: {
              x: Math.sign(targetX - state.south.body.x) * bot.arenaSpeed,
              z: state.south.body.z > 6 ? -bot.arenaSpeed : 0,
            },
            aim: botAim,
            fire: state.tick % bot.arenaFire === 0,
            zoomed: difficulty !== 'easy',
            jump: difficulty === 'extra-hard' && state.tick % 160 === 0,
          },
        });
        if (outcome.state.north.health < state.north.health) damageAt = now;
        if (outcome.state.north.spawnEpoch !== state.north.spawnEpoch) input.faceSeat('north');
        state = outcome.state;
        for (const shot of outcome.shots) {
          shots.push({
            ...shot,
            seenAt: now,
            mine: shot.shooter === 'north',
            muzzle:
              shot.shooter === 'north'
                ? viewModelMuzzle(
                    viewModelOf(
                      eyePosition(state.north.body),
                      input.forward(),
                      state.north.body,
                      scope,
                    ),
                  )
                : null,
          });
          if (shot.hitPlayer && shot.shooter === 'north') hitAt = now;
        }
        if (state.phase === 'finished') {
          active = false;
          input.releaseLock();
          listeners.onFinish(
            state.winner === 'north' ? 'You take this round.' : 'The bot takes this one. Rematch?',
          );
          break;
        }
      }
    }
    const wanted = active && input.isZoomed() ? 1 : 0;
    scope +=
      Math.sign(wanted - scope) * Math.min(Math.abs(wanted - scope), elapsed / SCOPE_RAISE_MS);
    const eye = eyePosition(state.north.body);
    const facing = input.forward();
    const model = state.north.alive ? viewModelOf(eye, facing, state.north.body, scope) : [];
    shots = shots.filter((shot) => now - shot.seenAt < 300);
    const fieldOfView =
      DEFAULT_ARENA_SETTINGS.look.fieldOfView * (1 - scope + scope / SCOPE_MAGNIFICATION);
    renderer.render(
      {
        camera: { position: eye, forward: facing, fieldOfView },
        seat: 'north',
        players: [
          { seat: 'south', body: state.south.body, aim: state.south.aim, alive: state.south.alive },
        ],
        viewModel: model,
        shots: drawableShots(shots, now, viewModelMuzzle(model)),
        hud: {
          ownScore: state.north.score,
          opponentScore: state.south.score,
          message:
            active && state.phase === 'countdown'
              ? String(Math.ceil(state.phaseTicks / TICK_RATE))
              : '',
          respawnSeconds: state.north.respawnTicks / TICK_RATE,
          crosshair: active && state.north.alive && state.phase === 'playing',
          scope,
          hitMarker: fadeSince(now, hitAt, 0.35),
          damage: fadeSince(now, damageAt, 0.6),
          health: state.north.health / MAX_HEALTH,
        },
      },
      0,
    );
  }
  frame = requestAnimationFrame(draw);
  function pause() {
    active = false;
    accumulator = 0;
    input.reset();
    input.releaseLock();
    listeners.onPause();
  }
  const onVisibility = () => {
    if (document.hidden) pause();
    lastAt = 0;
  };
  document.addEventListener('visibilitychange', onVisibility);
  return {
    start() {
      active = true;
      accumulator = 0;
      lastAt = 0;
      if (!matchMedia('(pointer: coarse)').matches) input.requestLock();
    },
    pause,
    restart() {
      state = startCountdown(createInitialState(), TICK_RATE * 3);
      input.faceSeat('north');
      shots = [];
      scope = 0;
      hitAt = null;
      damageAt = null;
      shotsAcked = input.sample(seq).shotsFired;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      active = false;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
      input.stop();
      renderer.destroy();
    },
  };
}
