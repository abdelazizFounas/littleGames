import type { InputCommand } from './input-command';

/**
 * Abstract producer of typed input commands.
 *
 * An implementation wraps one concrete device — keyboard, touch surface, or a
 * scripted opponent used in tests — while the game only ever sees
 * `InputCommand` values. Swapping the device therefore never reaches the
 * simulation.
 *
 * @typeParam TCommand - Concrete command type the game consumes.
 */
export interface InputSource<TCommand extends InputCommand> {
  /**
   * Start observing the underlying device.
   *
   * Called once before the first call to `sample`.
   */
  start(): void;

  /**
   * Capture the current device state as a command.
   *
   * @param seq - Sequence number to stamp on the produced command.
   */
  sample(seq: number): TCommand;

  /** Stop observing and release everything `start` registered. */
  stop(): void;
}
