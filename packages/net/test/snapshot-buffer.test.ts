import { describe, expect, it } from 'vitest';
import { createSnapshotBuffer } from '../src/snapshot-buffer';

const DELAY = 100;

function buffer() {
  return createSnapshotBuffer<string>({ delayMs: DELAY });
}

describe('snapshot buffer', () => {
  it('reports nothing before any snapshot arrives', () => {
    expect(buffer().sampleAt(1000)).toBeNull();
  });

  it('interpolates between the two snapshots bracketing the render time', () => {
    const b = buffer();
    b.push('a', 1000);
    b.push('b', 1100);

    // Rendering at 1150 means drawing 1050, halfway between the two.
    const window = b.sampleAt(1150);

    expect(window).toEqual({ from: 'a', to: 'b', alpha: 0.5, starved: false });
  });

  it('places the render time correctly when it is not halfway', () => {
    const b = buffer();
    b.push('a', 1000);
    b.push('b', 1200);

    expect(b.sampleAt(1150)?.alpha).toBeCloseTo(0.25, 9);
  });

  it('holds the oldest snapshot rather than extrapolating backwards', () => {
    const b = buffer();
    b.push('a', 1000);
    b.push('b', 1100);

    // Rendering at 1050 means drawing 950, before anything we hold.
    expect(b.sampleAt(1050)).toEqual({ from: 'a', to: 'a', alpha: 0, starved: false });
  });

  it('freezes on the newest when nothing arrives in time, and says so', () => {
    const b = buffer();
    b.push('a', 1000);
    b.push('b', 1100);

    // Half a second on with no new snapshot: the buffer has run dry.
    const window = b.sampleAt(1700);

    expect(window).toEqual({ from: 'b', to: 'b', alpha: 1, starved: true });
  });

  it('drops a snapshot that arrives out of order', () => {
    const b = buffer();
    b.push('a', 1000);
    b.push('b', 1100);
    b.push('late', 1050);

    // Accepting it would pull the picture backwards, since it is older than
    // what is already being drawn towards.
    expect(b.size).toBe(2);
    expect(b.latest()).toBe('b');
  });

  it('keeps only the most recent snapshots', () => {
    const b = createSnapshotBuffer<number>({ delayMs: DELAY, capacity: 3 });
    for (let index = 0; index < 10; index += 1) {
      b.push(index, 1000 + index * 10);
    }

    expect(b.size).toBe(3);
    expect(b.latest()).toBe(9);
  });

  it('survives two snapshots stamped at the same instant', () => {
    const b = buffer();
    b.push('a', 1000);
    b.push('b', 1000);
    b.push('c', 1100);

    expect(() => b.sampleAt(1150)).not.toThrow();
    expect(b.sampleAt(1150)?.alpha).not.toBeNaN();
  });

  it('exposes the freshest snapshot for values that must not be blended', () => {
    const b = buffer();
    b.push('a', 1000);
    b.push('b', 1100);

    // A score or a phase has to jump, not slide.
    expect(b.latest()).toBe('b');
  });
});
