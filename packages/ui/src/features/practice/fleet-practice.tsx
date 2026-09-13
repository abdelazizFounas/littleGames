import { useEffect, useState } from 'react';
import { FleetCommand } from '../fleet/fleet-command';
import { chooseFleetShot } from './practice-bots';
import {
  createFleetRound,
  deployPracticeFleet,
  firePracticeShot,
  practiceFleetView,
} from './fleet-practice-state';
import { DIFFICULTY_LABELS, type PracticeDifficulty } from './difficulty';

export function FleetPractice({ difficulty }: { readonly difficulty: PracticeDifficulty }) {
  const [round, setRound] = useState(() => createFleetRound());
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const finished = round.state.phase === 'finished';
  useEffect(() => {
    if (!started || paused || round.state.phase !== 'playing' || round.state.turn !== 'b')
      return undefined;
    const timeout = setTimeout(
      () => {
        const shot = chooseFleetShot(round.incoming, difficulty);
        if (shot) setRound((current) => firePracticeShot(current, 'b', shot));
      },
      difficulty === 'easy' ? 1250 : difficulty === 'hard' ? 850 : 550,
    );
    return () => clearTimeout(timeout);
  }, [round, difficulty, started, paused]);
  useEffect(() => {
    const pause = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && started && !finished) setPaused(true);
    };
    const hide = () => {
      if (document.hidden && started && !finished) setPaused(true);
    };
    window.addEventListener('keydown', pause);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('keydown', pause);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [started, finished]);
  function restart() {
    setRound(createFleetRound());
    setPaused(false);
    setStarted(false);
    setAttempt((value) => value + 1);
  }
  return (
    <div className="fleet-practice">
      <div className="fleet-practice__frame">
        <FleetCommand
          key={attempt}
          view={practiceFleetView(round)}
          opponent={`${DIFFICULTY_LABELS[difficulty]} bot`}
          blocked={!started || paused}
          controls={
            started &&
            !finished && (
              <button className="fleet-pause" disabled={paused} onClick={() => setPaused(true)}>
                Pause
              </button>
            )
          }
          overlay={
            (!started || paused) && (
              <div className="practice-overlay fleet-practice__overlay">
                <p className="eyebrow">
                  SOLO NAVAL OPERATIONS · {DIFFICULTY_LABELS[difficulty].toUpperCase()}
                </p>
                <h2>{paused ? 'The ocean can wait.' : 'Your fleet. Your strategy.'}</h2>
                <p>
                  {paused
                    ? 'Your opponent waits while you take a break.'
                    : 'Deploy five ships, read the enemy waters, and sink the bot’s fleet. A hit keeps your turn.'}
                </p>
                <button
                  className="button button--primary"
                  onClick={() => {
                    setStarted(true);
                    setPaused(false);
                  }}
                >
                  {paused ? 'Resume game' : 'Let’s play'} ↗
                </button>
              </div>
            )
          }
          onConfirm={(fleet) => setRound((current) => deployPracticeFleet(current, fleet))}
          onFire={(row, column) =>
            setRound((current) => firePracticeShot(current, 'a', { row, column }))
          }
        />
      </div>
      <div className="practice-toolbar">
        <span>
          {finished ? 'MISSION COMPLETE' : 'SELECT A SHIP · R TO ROTATE · SELECT A TARGET AND FIRE'}{' '}
          · PRACTICE SCORES STAY LOCAL
        </span>
        <div className="actions">
          <button className="button" onClick={restart}>
            {finished ? 'Play again' : 'Restart'}
          </button>
        </div>
      </div>
    </div>
  );
}
