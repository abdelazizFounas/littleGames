import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useMatch } from './use-match';

/**
 * Joins a match and shows what the server sends back.
 *
 * This is the phase 3 proof rather than the finished controls: it exists to
 * make the round trip visible, so you can watch your own key presses come back
 * inside the authoritative state, acknowledged by sequence number. The real
 * Pong controls replace the buttons below in phase 5.
 */
export function MatchPanel(): ReactNode {
  const { state, join, leave, sendInput } = useMatch();
  const held = useRef({ up: false, down: false });

  const press = useCallback(
    (direction: 'up' | 'down', pressed: boolean): void => {
      if (held.current[direction] === pressed) {
        return;
      }
      held.current[direction] = pressed;
      sendInput(held.current.up, held.current.down);
    },
    [sendInput],
  );

  useEffect(() => {
    if (state.status !== 'joined') {
      return undefined;
    }

    const directionOf = (key: string): 'up' | 'down' | null => {
      if (key === 'ArrowUp') {
        return 'up';
      }
      return key === 'ArrowDown' ? 'down' : null;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const direction = directionOf(event.key);
      if (direction !== null) {
        event.preventDefault();
        press(direction, true);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const direction = directionOf(event.key);
      if (direction !== null) {
        press(direction, false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [press, state.status]);

  if (state.status === 'idle') {
    return (
      <div className="form">
        <h2>Match</h2>
        <button type="button" className="button button--primary" onClick={join}>
          Join a match
        </button>
      </div>
    );
  }

  if (state.status === 'joining') {
    return (
      <div className="form">
        <h2>Match</h2>
        <p className="hint">Joining…</p>
      </div>
    );
  }

  if (state.status === 'failed') {
    return (
      <div className="form">
        <h2>Match</h2>
        <p role="alert" className="error">
          {state.error}
        </p>
        <button type="button" className="button" onClick={join}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="form">
      <h2>Match</h2>
      <p className="hint">
        Open this page in a second browser to see both players in the same match. Hold the arrow
        keys, or the buttons below, and watch the server echo them back.
      </p>

      <dl className="facts">
        <div>
          <dt>Match</dt>
          <dd className="facts__id">{state.matchId}</dd>
        </div>
        <div>
          <dt>Tick</dt>
          <dd>{state.snapshot?.tick ?? '—'}</dd>
        </div>
      </dl>

      {state.snapshot === null ? (
        <p className="hint">Waiting for the first snapshot…</p>
      ) : (
        <ul className="player-list">
          {state.snapshot.players.map((player) => (
            <li key={player.userId}>
              <span className="player-list__name">{player.username}</span>
              <span className="player-list__meta">seq {player.lastProcessedSeq}</span>
              <span className="player-list__meta">
                {player.up ? '▲' : '·'} {player.down ? '▼' : '·'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="actions">
        <button
          type="button"
          className="button"
          onPointerDown={() => {
            press('up', true);
          }}
          onPointerUp={() => {
            press('up', false);
          }}
          onPointerLeave={() => {
            press('up', false);
          }}
        >
          Up
        </button>
        <button
          type="button"
          className="button"
          onPointerDown={() => {
            press('down', true);
          }}
          onPointerUp={() => {
            press('down', false);
          }}
          onPointerLeave={() => {
            press('down', false);
          }}
        >
          Down
        </button>
        <button type="button" className="link-button link-button--inline" onClick={leave}>
          Leave
        </button>
      </div>
    </div>
  );
}
