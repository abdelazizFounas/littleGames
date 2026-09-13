import { useEffect, useReducer, useState } from 'react';
import type { BattleshipView, MarkedShot } from '@littlegames/battleship-logic';

export interface TorpedoEvent {
  readonly id: number;
  readonly direction: 'incoming' | 'outgoing';
  readonly shot: MarkedShot;
  readonly view: BattleshipView;
  readonly phase: 'flight' | 'impact';
}
export interface Presentation {
  readonly latest: BattleshipView;
  readonly view: BattleshipView;
  readonly active: TorpedoEvent | null;
  readonly queue: readonly TorpedoEvent[];
  readonly serial: number;
}
type Action = { type: 'receive'; view: BattleshipView } | { type: 'advance' };
export function initialPresentation(view: BattleshipView): Presentation {
  return { latest: view, view, active: null, queue: [], serial: 0 };
}
/** Animate live actions in order. Reconnect/catch-up snapshots establish a fresh baseline. */
export function presentationReducer(state: Presentation, action: Action): Presentation {
  if (action.type === 'receive') {
    const next = action.view;
    if (next === state.latest) return state;
    const incoming = next.incoming.length - state.latest.incoming.length;
    const outgoing = next.outgoing.length - state.latest.outgoing.length;
    if (
      incoming < 0 ||
      outgoing < 0 ||
      incoming + outgoing > 1 ||
      (state.latest.phase !== 'playing' && incoming + outgoing > 0)
    ) {
      return { ...initialPresentation(next), serial: state.serial };
    }
    const direction = incoming === 1 ? 'incoming' : 'outgoing';
    const shot = incoming + outgoing === 1 ? next[direction].at(-1) : undefined;
    if (!shot) return { ...state, latest: next, view: state.active ? state.view : next };
    const event: TorpedoEvent = {
      id: state.serial + 1,
      direction,
      shot,
      view: next,
      phase: 'flight',
    };
    return {
      ...state,
      latest: next,
      serial: event.id,
      active: state.active ?? event,
      queue: state.active ? [...state.queue, event] : [],
    };
  }
  if (!state.active) return state;
  if (state.active.phase === 'flight') {
    return { ...state, view: state.active.view, active: { ...state.active, phase: 'impact' } };
  }
  const [active, ...queue] = state.queue;
  return { ...state, active: active ?? null, queue, view: active ? state.view : state.latest };
}
export function useFleetPresentation(source: BattleshipView, paused: boolean) {
  const [state, dispatch] = useReducer(presentationReducer, source, initialPresentation);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    dispatch({ type: 'receive', view: source });
  }, [source]);
  useEffect(() => {
    if (!state.active || paused) return undefined;
    const duration = reducedMotion
      ? 0
      : state.active.phase === 'flight'
        ? 650
        : state.active.shot.result === 'sunk'
          ? 1100
          : 450;
    const timer = setTimeout(() => dispatch({ type: 'advance' }), duration);
    return () => clearTimeout(timer);
  }, [state.active, paused, reducedMotion]);
  return { view: state.view, active: state.active, reducedMotion };
}
