import { describe, expect, it } from 'vitest';
import { createInputHistory, reconcile } from '../src/prediction';

interface Move {
  readonly seq: number;
  readonly delta: number;
}

describe('input history', () => {
  it('keeps commands until the server confirms them', () => {
    const history = createInputHistory<Move>();
    history.record({ seq: 1, delta: 1 });
    history.record({ seq: 2, delta: 1 });
    history.record({ seq: 3, delta: 1 });

    history.acknowledge(2);

    expect(history.pending()).toEqual([{ seq: 3, delta: 1 }]);
  });

  it('keeps everything when the server has confirmed nothing', () => {
    const history = createInputHistory<Move>();
    history.record({ seq: 1, delta: 1 });
    history.acknowledge(0);

    expect(history.size).toBe(1);
  });

  it('ignores an acknowledgement older than one already applied', () => {
    const history = createInputHistory<Move>();
    history.record({ seq: 5, delta: 1 });
    history.acknowledge(4);
    history.acknowledge(2);

    expect(history.size).toBe(1);
  });

  it('bounds its memory when acknowledgements stop arriving', () => {
    const history = createInputHistory<Move>(4);
    for (let seq = 1; seq <= 10; seq += 1) {
      history.record({ seq, delta: 1 });
    }

    expect(history.size).toBe(4);
    expect(history.pending().at(0)?.seq).toBe(7);
  });
});

const apply = (total: number, move: Move): number => total + move.delta;
const applyOrdered = (text: string, move: Move): string => `${text}${String(move.delta)}`;

describe('reconcile', () => {
  it('replays what the server has not seen on top of what it has', () => {
    // The server is at 10 and has processed up to seq 2. Two commands are still
    // in flight, so the present is 12.
    expect(reconcile(10, [{ seq: 3, delta: 1 }, { seq: 4, delta: 1 }], apply)).toBe(12);
  });

  it('returns the authoritative state untouched when nothing is pending', () => {
    expect(reconcile(10, [], apply)).toBe(10);
  });

  it('lands where the server will once it has caught up', () => {
    // The property that makes prediction work: replaying the same commands the
    // server is about to process reaches the same answer, so the correction
    // when the next snapshot arrives is nothing at all.
    const commands: Move[] = [
      { seq: 1, delta: 3 },
      { seq: 2, delta: -1 },
      { seq: 3, delta: 4 },
    ];
    const predicted = reconcile(0, commands, apply);
    const serverEventually = commands.reduce(apply, 0);

    expect(predicted).toBe(serverEventually);
  });

  it('applies commands in order', () => {
    expect(
      reconcile('', [{ seq: 1, delta: 1 }, { seq: 2, delta: 2 }, { seq: 3, delta: 3 }], applyOrdered),
    ).toBe('123');
  });
});
