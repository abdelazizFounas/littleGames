import { describe, expect, it } from 'vitest';
import { resolveDeviceId } from '../src/device-id';
import { createMemoryKeyValueStore } from '../src/key-value-store';

describe('resolveDeviceId', () => {
  it('generates an identifier on first call', () => {
    const store = createMemoryKeyValueStore();

    expect(resolveDeviceId(store, () => 'generated-id')).toBe('generated-id');
  });

  it('returns the same identifier on every later call', () => {
    const store = createMemoryKeyValueStore();
    let generatedCount = 0;
    const generate = (): string => `id-${String(++generatedCount)}`;

    const first = resolveDeviceId(store, generate);
    const second = resolveDeviceId(store, generate);

    // A second identifier would silently orphan the guest account bound to the
    // first one, so the generator must not be consulted again.
    expect(second).toBe(first);
    expect(generatedCount).toBe(1);
  });

  it('replaces an empty stored value rather than authenticating with it', () => {
    const store = createMemoryKeyValueStore();
    store.write('littlegames.device-id', '');

    expect(resolveDeviceId(store, () => 'recovered-id')).toBe('recovered-id');
  });
});
