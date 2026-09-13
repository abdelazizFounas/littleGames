import { useEffect, useState } from 'react';
import {
  act,
  chooseArtilleryShot,
  createArtillery,
  type Action,
} from '@littlegames/artillery-logic';
import { ArtilleryCommand } from './artillery-command';
import { DIFFICULTY_LABELS, type PracticeDifficulty } from '../practice/difficulty';
export function ArtilleryPractice({ difficulty }: { readonly difficulty: PracticeDifficulty }) {
  const [state, setState] = useState(() => act(createArtillery(), 1, { type: 'ready' }).state);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  function send(action: Action) {
    const result = act(state, 0, action);
    setNotice(result.error);
    let next = result.state;
    if (action.type === 'configure') next = act(next, 1, { type: 'ready' }).state;
    setState(next);
  }
  useEffect(() => {
    if (busy) return undefined;
    if (state.phase === 'round-over' && !state.ready[1]) {
      const readyTimer = setTimeout(
        () => setState((current) => act(current, 1, { type: 'ready' }).state),
        600,
      );
      return () => clearTimeout(readyTimer);
    }
    if (state.phase !== 'playing' || state.turn !== 1) return undefined;
    const timer = setTimeout(
      () => {
        setState((current) => act(current, 1, chooseArtilleryShot(current, 1, difficulty)).state);
      },
      difficulty === 'easy' ? 1400 : difficulty === 'hard' ? 1050 : 800,
    );
    return () => clearTimeout(timer);
  }, [state, busy, difficulty]);
  return (
    <ArtilleryCommand
      key={attempt}
      state={state}
      practice
      names={['You', `${DIFFICULTY_LABELS[difficulty]} bot`]}
      notice={notice}
      onAction={send}
      onBusyChange={setBusy}
      onRestart={() => {
        setBusy(false);
        setState(act(createArtillery(state.options), 1, { type: 'ready' }).state);
        setAttempt((value) => value + 1);
        setNotice(null);
      }}
    />
  );
}
