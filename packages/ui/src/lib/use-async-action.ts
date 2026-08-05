import { useCallback, useState } from 'react';
import { describeError } from './describe-error';

export interface AsyncAction {
  readonly pending: boolean;
  readonly error: string | null;
  /** Runs the action, tracking its pending state and surfacing any failure. */
  run: (action: () => Promise<void>) => void;
  clearError: () => void;
}

/**
 * Drives one asynchronous action from a form or a button.
 *
 * Every auth screen needs the same three things — a pending flag to disable
 * the control, a readable error, and the guarantee that a rejection never
 * escapes as an unhandled promise.
 */
export function useAsyncAction(fallbackMessage = 'Something went wrong.'): AsyncAction {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (action: () => Promise<void>): void => {
      setPending(true);
      setError(null);
      void action()
        .catch((cause: unknown) => {
          setError(describeError(cause, fallbackMessage));
        })
        .finally(() => {
          setPending(false);
        });
    },
    [fallbackMessage],
  );

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  return { pending, error, run, clearError };
}
