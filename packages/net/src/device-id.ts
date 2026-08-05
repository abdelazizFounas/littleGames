import type { KeyValueStore } from './key-value-store';

const DEVICE_ID_KEY = 'littlegames.device-id';

/**
 * Returns the stable identifier this browser authenticates with, creating and
 * persisting one on first call.
 *
 * Guest accounts are keyed on this value, so losing it means losing the
 * account: it must be generated once and never regenerated while it is
 * readable.
 *
 * @param generateId - Identifier factory, injected so tests stay deterministic.
 */
export function resolveDeviceId(
  store: KeyValueStore,
  generateId: () => string = () => crypto.randomUUID(),
): string {
  const existing = store.read(DEVICE_ID_KEY);
  if (existing !== null && existing.length > 0) {
    return existing;
  }

  const created = generateId();
  store.write(DEVICE_ID_KEY, created);
  return created;
}
