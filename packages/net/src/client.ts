import { Client } from '@heroiclabs/nakama-js';
import type { NakamaConfig } from './config';

/**
 * Builds the Nakama client used for every server call.
 *
 * Automatic session refresh is left enabled, so an expired token is renewed
 * transparently before a request goes out. That renewal mutates the `Session`
 * object in place, which is why callers must re-persist the session after any
 * operation — see `persistSession`.
 */
export function createNakamaClient(config: NakamaConfig): Client {
  return new Client(config.serverKey, config.host, config.port, config.useSSL);
}
