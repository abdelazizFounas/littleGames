import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { describeError } from '../../lib/describe-error';
import { useSession } from '../../session/use-session';
import { startPongSession, type SessionStatus } from './pong-session';

/**
 * Hands a plain DOM element to the game and then stays out of the way.
 *
 * The element is the only thing this component gives the loop, and the loop
 * never asks it to re-render: React is here to place a box on the page and to
 * report connecting or failing, nothing else.
 */
export function PongStage({
  userId,
  matchId,
  onJoined,
}: {
  readonly userId: string;
  /** Set when arriving from an invitation; otherwise any match with room. */
  readonly matchId?: string | undefined;
  /** Called with the match actually joined, so it can be invited into. */
  readonly onJoined: (matchId: string) => void;
}): ReactNode {
  const { joinMatch } = useSession();
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SessionStatus>({ kind: 'connecting' });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }

    let cancelled = false;
    let started: { stop: () => void } | null = null;

    const run = async (): Promise<void> => {
      try {
        const session = await startPongSession(container, userId, matchId, joinMatch, (next) => {
          if (cancelled) {
            return;
          }
          setStatus(next);
          if (next.kind === 'playing') {
            onJoined(next.matchId);
          }
        });
        if (cancelled) {
          // The screen was left while the match was still being joined; without
          // this the seat would stay occupied by nobody.
          session.stop();
          return;
        }
        started = session;
      } catch (cause) {
        if (!cancelled) {
          setStatus({ kind: 'failed', message: describeError(cause, 'Could not start the match.') });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      started?.stop();
    };
  }, [joinMatch, matchId, onJoined, userId]);

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

  return (
    <div className="stage">
      <div ref={frameRef} className="stage__frame">
        <div ref={containerRef} className="stage__surface" />
      </div>

      <div className="stage__bar">
        {status.kind === 'connecting' && <p className="hint stage__hint">Joining a match…</p>}
        {status.kind === 'playing' && (
          <p className="hint stage__hint">
            You are the <strong>{status.side}</strong> paddle. Arrow keys or W and S, or drag on the
            field.
          </p>
        )}
        {status.kind === 'failed' && (
          <p role="alert" className="error stage__hint">
            {status.message}
          </p>
        )}
        <button type="button" className="button" onClick={toggleFullscreen}>
          {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
    </div>
  );
}
