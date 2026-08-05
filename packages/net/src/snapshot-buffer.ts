/** Two snapshots and where between them to draw. */
export interface InterpolationWindow<T> {
  readonly from: T;
  readonly to: T;
  /** Position between `from` and `to`, in `[0, 1]`. */
  readonly alpha: number;
  /** True when the buffer ran dry and `to` is simply the newest we hold. */
  readonly starved: boolean;
}

export interface SnapshotBuffer<T> {
  /** Records a snapshot as having arrived at `at`, in milliseconds. */
  push: (snapshot: T, at: number) => void;
  /** The window to draw for wall-clock time `now`, or null before anything arrived. */
  sampleAt: (now: number) => InterpolationWindow<T> | null;
  /** The freshest snapshot, for values that must not be blended. */
  latest: () => T | null;
  /**
   * Forgets everything held.
   *
   * Used after a reconnection or a return from the background, where what is
   * buffered describes a moment the match has long since left.
   */
  reset: () => void;
  readonly size: number;
}

export interface SnapshotBufferOptions {
  /**
   * How far behind live to draw, in milliseconds.
   *
   * Drawing the very latest snapshot means drawing a new one only when it
   * arrives, so any jitter in arrival becomes visible stutter. Holding a small
   * delay means there is almost always a later snapshot to interpolate towards,
   * which trades a little latency for continuous motion.
   */
  readonly delayMs: number;
  /** How many snapshots to retain. Older ones are dropped. */
  readonly capacity?: number;
}

const DEFAULT_CAPACITY = 32;

export function createSnapshotBuffer<T>(options: SnapshotBufferOptions): SnapshotBuffer<T> {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const times: number[] = [];
  const values: T[] = [];

  return {
    get size() {
      return values.length;
    },

    push(snapshot, at) {
      // Out-of-order arrivals are dropped rather than inserted. They are older
      // than what is already drawn, so they can only pull the picture
      // backwards.
      const newest = times.at(-1);
      if (newest !== undefined && at < newest) {
        return;
      }
      times.push(at);
      values.push(snapshot);
      while (values.length > capacity) {
        times.shift();
        values.shift();
      }
    },

    latest() {
      return values.at(-1) ?? null;
    },

    reset() {
      times.length = 0;
      values.length = 0;
    },

    sampleAt(now) {
      if (values.length === 0) {
        return null;
      }

      const first = values[0];
      const last = values.at(-1);
      if (first === undefined || last === undefined) {
        return null;
      }

      const target = now - options.delayMs;

      const oldestTime = times[0];
      if (oldestTime === undefined || target <= oldestTime) {
        // Not enough history yet: hold the oldest rather than extrapolate into
        // a past we never saw.
        return { from: first, to: first, alpha: 0, starved: false };
      }

      for (let index = 1; index < times.length; index += 1) {
        const later = times[index];
        const earlier = times[index - 1];
        const laterValue = values[index];
        const earlierValue = values[index - 1];
        if (
          later === undefined ||
          earlier === undefined ||
          laterValue === undefined ||
          earlierValue === undefined
        ) {
          continue;
        }
        if (target <= later) {
          const span = later - earlier;
          // Two snapshots stamped at the same instant would divide by zero.
          const alpha = span === 0 ? 1 : (target - earlier) / span;
          return { from: earlierValue, to: laterValue, alpha, starved: false };
        }
      }

      // Nothing newer has arrived in time. Freezing on the newest is the honest
      // answer: extrapolating invents motion the server never sent, and has to
      // be visibly corrected the moment it is wrong.
      return { from: last, to: last, alpha: 1, starved: true };
    },
  };
}
