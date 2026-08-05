/**
 * Everything needed to reach a Nakama server.
 *
 * The server key is not a secret: it ships inside the browser bundle by
 * design, and authorises nothing beyond opening a session. Real secrets stay
 * on the server.
 */
export interface NakamaConfig {
  readonly serverKey: string;
  /** Hostname only, without scheme or port. */
  readonly host: string;
  /** Port as a string, which is the shape the Nakama SDK expects. */
  readonly port: string;
  readonly useSSL: boolean;
}
