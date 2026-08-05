/** Anything the server acknowledges by sequence number. */
export interface Sequenced {
  readonly seq: number;
}

export interface InputHistory<TCommand extends Sequenced> {
  /** Remembers a command that has been sent but not yet acknowledged. */
  record: (command: TCommand) => void;
  /** Forgets everything the server has confirmed it processed. */
  acknowledge: (seq: number) => void;
  /** Commands the server has not confirmed yet, oldest first. */
  pending: () => readonly TCommand[];
  clear: () => void;
  readonly size: number;
}

/**
 * Keeps the commands the server has not acknowledged yet.
 *
 * A client draws its own paddle from its own inputs immediately, without
 * waiting for the round trip, or the paddle would lag behind the key by the
 * whole latency. The server is still the authority, so when its state arrives
 * the client rewinds to it and replays whatever it has sent since — which is
 * exactly what this holds.
 */
export function createInputHistory<TCommand extends Sequenced>(
  capacity = 256,
): InputHistory<TCommand> {
  let commands: TCommand[] = [];

  return {
    get size() {
      return commands.length;
    },

    record(command) {
      commands.push(command);
      if (commands.length > capacity) {
        // A history this long means acknowledgements stopped arriving. Dropping
        // the oldest bounds the memory; the replay is wrong either way at that
        // point, and the next snapshot corrects it.
        commands.shift();
      }
    },

    acknowledge(seq) {
      commands = commands.filter((command) => command.seq > seq);
    },

    pending() {
      return commands;
    },

    clear() {
      commands = [];
    },
  };
}

/**
 * Rebuilds the present from the last authoritative state.
 *
 * The server's state is always in the past by one round trip. Replaying the
 * commands it has not seen yet brings it back up to now, and because the rules
 * are deterministic the result matches what the server will itself compute.
 */
export function reconcile<TState, TCommand>(
  authoritative: TState,
  pending: readonly TCommand[],
  apply: (state: TState, command: TCommand) => TState,
): TState {
  let state = authoritative;
  for (const command of pending) {
    state = apply(state, command);
  }
  return state;
}
