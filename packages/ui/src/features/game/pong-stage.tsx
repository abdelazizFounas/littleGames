import { useEffect, useRef, useState, type ReactNode } from 'react';
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
export function PongStage({ userId }: { readonly userId: string }): ReactNode {
  const { joinMatch } = useSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SessionStatus>({ kind: 'connecting' });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }

    let cancelled = false;
    let started: { stop: () => void } | null = null;

    const run = async (): Promise<void> => {
      try {
        const session = await startPongSession(container, userId, joinMatch, (next) => {
          if (!cancelled) {
            setStatus(next);
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
  }, [joinMatch, userId]);

  return (
    <div className="stage">
      <div ref={containerRef} className="stage__surface" />
      {status.kind === 'connecting' && <p className="hint">Joining a match…</p>}
      {status.kind === 'playing' && (
        <p className="hint">
          You are the {status.side} paddle. Arrow keys or W and S, or drag on the field.
        </p>
      )}
      {status.kind === 'failed' && (
        <p role="alert" className="error">
          {status.message}
        </p>
      )}
    </div>
  );
}
