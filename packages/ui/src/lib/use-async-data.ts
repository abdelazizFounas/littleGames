import { useEffect, useState } from 'react';
import { describeError } from './describe-error';

export type AsyncData<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'failed'; readonly error: string };

/**
 * Loads a value once, and again whenever `load` changes identity.
 *
 * The cancellation flag matters beyond tidiness: React runs effects twice in
 * development, and a player can leave a screen mid-request, so without it a
 * late response would write into an unmounted component or overwrite fresher
 * data.
 */
export function useAsyncData<T>(load: () => Promise<T>, fallbackMessage: string): AsyncData<T> {
  const [state, setState] = useState<AsyncData<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    const run = async (): Promise<void> => {
      try {
        const data = await load();
        if (!cancelled) {
          setState({ status: 'ready', data });
        }
      } catch (cause) {
        if (!cancelled) {
          setState({ status: 'failed', error: describeError(cause, fallbackMessage) });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [fallbackMessage, load]);

  return state;
}
