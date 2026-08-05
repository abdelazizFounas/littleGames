import type { Snapshot } from '@littlegames/core';
import type { MatchConnection } from '@littlegames/net';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../../lib/describe-error';
import { useSession } from '../../session/use-session';

export type MatchState =
  | { readonly status: 'idle' }
  | { readonly status: 'joining' }
  | { readonly status: 'joined'; readonly matchId: string; readonly snapshot: Snapshot | null }
  | { readonly status: 'failed'; readonly error: string };

export interface MatchController {
  readonly state: MatchState;
  readonly join: () => void;
  readonly leave: () => void;
  /** Sends what this player is holding, stamped with the next sequence number. */
  readonly sendInput: (up: boolean, down: boolean) => void;
}

/**
 * Drives one match connection for a screen.
 *
 * The connection lives in a ref rather than in state: re-rendering on every
 * snapshot must not tear down and rebuild the socket, and at 30 snapshots a
 * second it would.
 */
export function useMatch(): MatchController {
  const { joinMatch } = useSession();
  const [state, setState] = useState<MatchState>({ status: 'idle' });
  const connection = useRef<MatchConnection | null>(null);
  const nextSeq = useRef(1);

  // Leaving on unmount is what stops a player who navigates away from
  // occupying a seat nobody is sitting in.
  useEffect(
    () => () => {
      void connection.current?.leave();
      connection.current = null;
    },
    [],
  );

  const join = useCallback((): void => {
    if (connection.current !== null) {
      return;
    }
    setState({ status: 'joining' });

    const run = async (): Promise<void> => {
      try {
        const joined = await joinMatch({
          // Updating from the previous state rather than closing over the
          // connection matters: a snapshot can land while `joinMatch` is still
          // resolving, and reading the not-yet-assigned binding would throw.
          onSnapshot: (snapshot) => {
            setState((previous) =>
              previous.status === 'joined' ? { ...previous, snapshot } : previous,
            );
          },
          onDisconnect: () => {
            connection.current = null;
            setState({ status: 'idle' });
          },
          onError: (cause) => {
            setState({ status: 'failed', error: describeError(cause, 'The match connection failed.') });
          },
        });
        connection.current = joined;
        setState({ status: 'joined', matchId: joined.matchId, snapshot: null });
      } catch (cause) {
        setState({ status: 'failed', error: describeError(cause, 'Could not join a match.') });
      }
    };

    void run();
  }, [joinMatch]);

  const leave = useCallback((): void => {
    const current = connection.current;
    connection.current = null;
    setState({ status: 'idle' });
    void current?.leave();
  }, []);

  const sendInput = useCallback((up: boolean, down: boolean): void => {
    const current = connection.current;
    if (current === null) {
      return;
    }
    void current.sendInput({ seq: nextSeq.current++, up, down });
  }, []);

  return { state, join, leave, sendInput };
}
