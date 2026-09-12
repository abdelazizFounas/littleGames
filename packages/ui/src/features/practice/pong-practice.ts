import { createInitialState, FIELD_HEIGHT, startCountdown, step, TICK_RATE } from '@littlegames/pong-logic';
import { createPongPixiRenderer } from '@littlegames/pong-renderer-pixi';
import type { PracticeListeners, PracticeSession } from './practice-session';

export async function createPractice(container: HTMLElement, listeners: PracticeListeners): Promise<PracticeSession> {
  const renderer = createPongPixiRenderer();
  try { await renderer.mount(container); } catch (cause) { renderer.destroy(); throw cause; }
  let state = startCountdown(createInitialState());
  let active = false;
  let frame = 0;
  let lastAt = 0;
  let accumulator = 0;
  let touchY: number | null = null;
  const held = new Set<string>();
  const keys = new Set(['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Escape', 'KeyP']);
  function onKeyDown(event: KeyboardEvent) {
    if (!active || !keys.has(event.code)) return;
    event.preventDefault();
    if (event.code === 'Escape' || event.code === 'KeyP') { pause(); return; }
    held.add(event.code);
  }
  const onKeyUp = (event: KeyboardEvent) => { held.delete(event.code); };
  const onPointer = (event: PointerEvent) => {
    if (!active || (event.pointerType === 'mouse' && !event.buttons)) return;
    const bounds = container.getBoundingClientRect();
    const scale = Math.min(bounds.width / 800, bounds.height / FIELD_HEIGHT);
    touchY = (event.clientY - bounds.top - (bounds.height - FIELD_HEIGHT * scale) / 2) / scale;
    if (event.type === 'pointerdown') { try { container.setPointerCapture(event.pointerId); } catch { /* The pointer may already have been released. */ } }
  };
  const onUp = () => { touchY = null; };
  function pause() { active = false; accumulator = 0; held.clear(); touchY = null; listeners.onPause(); }
  function draw(now: number) {
    frame = requestAnimationFrame(draw);
    const elapsed = lastAt ? Math.min(now - lastAt, 100) : 0;
    lastAt = now;
    if (active) {
      accumulator += elapsed;
      while (accumulator >= 1000 / TICK_RATE) {
        accumulator -= 1000 / TICK_RATE;
        const aim = state.ball.vx > 0 ? state.ball.y + Math.sin(state.ball.x / 95) * 33 : FIELD_HEIGHT / 2;
        state = step(state, { left: { up: held.has('ArrowUp') || held.has('KeyW') || (touchY !== null && touchY < state.left.y - 8), down: held.has('ArrowDown') || held.has('KeyS') || (touchY !== null && touchY > state.left.y + 8) }, right: { up: aim < state.right.y - 23, down: aim > state.right.y + 23 } });
        if (state.phase === 'finished') { active = false; listeners.onFinish(state.winner === 'left' ? 'You own the court.' : 'So close. One more round?'); break; }
      }
    }
    renderer.render(state, 0);
  }
  const resize = () => renderer.resize(container.clientWidth, container.clientHeight);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', pause);
  container.addEventListener('pointerdown', onPointer);
  container.addEventListener('pointermove', onPointer);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  frame = requestAnimationFrame(draw);
  return { start() { active = true; lastAt = 0; accumulator = 0; }, pause, restart() { state = startCountdown(createInitialState()); held.clear(); touchY = null; }, stop() { active = false; cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', pause); container.removeEventListener('pointerdown', onPointer); container.removeEventListener('pointermove', onPointer); container.removeEventListener('pointerup', onUp); container.removeEventListener('pointercancel', onUp); renderer.destroy(); } };
}
