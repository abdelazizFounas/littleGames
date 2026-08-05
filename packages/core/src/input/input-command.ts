/**
 * Base shape shared by every game input command.
 *
 * Commands carry intent only, never positions, so that the server stays the
 * single authority over the simulation and a tampered client cannot claim
 * where it is.
 */
export interface InputCommand {
  /**
   * Monotonically increasing sequence number stamped by the client.
   *
   * The server echoes back the last sequence number it processed. The client
   * then drops every acknowledged command and replays the remaining ones on
   * top of the authoritative state, which is what makes local prediction
   * reconcile instead of drift.
   */
  readonly seq: number;
}
