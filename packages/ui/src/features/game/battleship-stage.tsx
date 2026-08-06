import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { describeError } from '../../lib/describe-error';
import { useSession } from '../../session/use-session';
import {
  startBattleshipSession,
  type BattleshipSession,
  type BattleshipStatus,
} from './battleship-session';

function hintFor(status: BattleshipStatus): string {
  switch (status.kind) {
    case 'connecting': {
      return 'Joining the game…';
    }
    case 'waiting': {
      return 'Waiting for an opponent. Share an invitation to bring someone in.';
    }
    case 'placement': {
      if (status.ready || status.queued) {
        return status.opponentPresent
          ? 'Your fleet is set. Waiting for your opponent to place theirs.'
          : 'Your fleet is set. It goes over the moment an opponent joins.';
      }
      if (status.holding) {
        return 'Drop it on your grid. T turns it, Escape puts it back in the tray.';
      }
      if (status.complete) {
        return 'All five ships are down. Drag any of them to move it, or confirm the fleet.';
      }
      return status.opponentPresent
        ? 'Drag a ship from the tray onto your grid — or tap it, then tap a square.'
        : 'No rush — lay your fleet out while you wait. Drag a ship onto your grid, or tap it then tap a square.';
    }
    case 'playing': {
      return status.yourTurn
        ? 'Your turn. Pick a cell in their waters. A hit keeps the turn.'
        : 'Their turn. Watch where they are looking.';
    }
    case 'finished': {
      return status.won
        ? 'You sank their whole fleet.'
        : 'Your fleet is gone. Better luck next time.';
    }
    case 'reconnecting': {
      return 'Connection lost. Getting you back in…';
    }
    default: {
      return status.message;
    }
  }
}

/**
 * Hands a plain DOM element to the game and then stays out of the way.
 *
 * The element and the placement buttons are the only things this component
 * gives the loop. Every button is also a key, because a hand already holding a
 * ship with the mouse should not have to put it down to turn it — that is the
 * whole reason the keys exist. It re-renders when a phase changes, a turn
 * passes or a ship is picked up: a handful of times a game, never for the water
 * and never for a shot.
 */
export function BattleshipStage({
  matchId,
  password,
  onJoined,
}: {
  /** The lobby this screen is for; always known before it is reached. */
  readonly matchId: string;
  /** Password for a locked lobby, from the list or from an invitation. */
  readonly password?: string | undefined;
  /** Called with the match actually joined, so it can be invited into. */
  readonly onJoined: (matchId: string) => void;
}): ReactNode {
  const { joinBattleship } = useSession();
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<BattleshipSession | null>(null);
  const [status, setStatus] = useState<BattleshipStatus>({ kind: 'connecting' });
  const [notice, setNotice] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }

    const abort = new AbortController();
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        const session = await startBattleshipSession(
          container,
          matchId,
          password ?? '',
          joinBattleship,
          (next) => {
            if (!cancelled) {
              setStatus(next);
              // A refusal describes the move that has just been superseded.
              setNotice(null);
            }
          },
          (joined) => {
            if (!cancelled) {
              onJoined(joined);
            }
          },
          (reason) => {
            if (!cancelled) {
              setNotice(reason);
            }
          },
          abort.signal,
        );
        if (cancelled) {
          // The screen was left while the match was still being joined; without
          // this the seat would stay occupied by nobody.
          session.stop();
          return;
        }
        sessionRef.current = session;
      } catch (cause) {
        // A session abandoned before it began is not a failure worth showing.
        if (!cancelled) {
          setStatus({
            kind: 'failed',
            message: describeError(cause, 'Could not start the game.'),
          });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      abort.abort();
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, [joinBattleship, matchId, onJoined, password]);

  // Tracked from the document rather than from the click, so the button stays
  // honest when fullscreen is left with Escape.
  useEffect(() => {
    const onChange = (): void => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback((): void => {
    const frame = frameRef.current;
    if (frame === null) {
      return;
    }
    if (document.fullscreenElement === null) {
      // iOS Safari on iPhone still refuses this on anything but a video, so the
      // rejection is swallowed rather than shown as a fault.
      void frame.requestFullscreen().catch(() => undefined);
    } else {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  const placing = status.kind === 'placement' && !status.ready && !status.queued;

  return (
    <div className="stage">
      <div ref={frameRef} className="stage__frame">
        <div
          ref={containerRef}
          className={`stage__surface stage__surface--boards${placing ? ' stage__surface--placing' : ''}`}
        />
      </div>

      {placing && (
        <div className="actions stage__controls">
          <button
            type="button"
            className="button"
            onClick={() => {
              sessionRef.current?.rotate();
            }}
          >
            Turn the ship <kbd className="key">T</kbd>
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              sessionRef.current?.shuffle();
            }}
          >
            Arrange for me
          </button>
          <button
            type="button"
            className="button"
            disabled={status.placed === 0 && !status.holding}
            onClick={() => {
              sessionRef.current?.clear();
            }}
          >
            Start again
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!status.complete}
            onClick={() => {
              sessionRef.current?.confirm();
            }}
          >
            Confirm the fleet <kbd className="key">↵</kbd>
          </button>
        </div>
      )}

      <div className="stage__bar">
        {status.kind === 'failed' ? (
          <p role="alert" className="error stage__hint">
            {status.message}
          </p>
        ) : (
          <p className="hint stage__hint">{hintFor(status)}</p>
        )}
        <button type="button" className="button" onClick={toggleFullscreen}>
          {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>

      {notice !== null && (
        <p role="alert" className="error">
          {notice}
        </p>
      )}
    </div>
  );
}
