import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fire, placeFleet } from '../src/shots.ts';
import type { BattleshipState, Placement, Side } from '../src/state.ts';

type Action =
  | { readonly kind: 'place'; readonly side: Side; readonly fleet: Placement[] }
  | { readonly kind: 'fire'; readonly side: Side; readonly row: number; readonly column: number };

interface Vectors {
  readonly actions: Action[];
  readonly checkpoints: { readonly step: number; readonly state: BattleshipState }[];
}

// Reading a fixture the sibling generator wrote. The Go conformance test
// decodes the same file into its own structs.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('../testdata/vectors.json', import.meta.url)), 'utf8'),
) as Vectors;

/**
 * Replays the recorded game and checks every checkpoint.
 *
 * The same file is replayed by the Go implementation on the server. That is the
 * point of it: the rules exist twice, and nothing else would catch the two
 * drifting apart. A failure here is either a deliberate rules change —
 * regenerate and read the diff — or an accidental one.
 */
describe('conformance vectors', () => {
  it('plays a game through to a win', () => {
    const final = vectors.checkpoints.at(-1)?.state;

    expect(final?.phase).toBe('finished');
    expect(final?.winner).toBe('a');
  });

  it('replays to the same state, action for action', () => {
    const first = vectors.checkpoints.at(0);
    if (first === undefined) {
      throw new Error('the vectors hold no checkpoints');
    }

    let state: BattleshipState = first.state;
    let next = 1;

    for (const [step, action] of vectors.actions.entries()) {
      state =
        action.kind === 'place'
          ? placeFleet(state, action.side, action.fleet).state
          : fire(state, action.side, { row: action.row, column: action.column }).state;

      const expected = vectors.checkpoints[next];
      if (expected !== undefined && expected.step === step + 1) {
        expect(state, `diverged at action ${String(step + 1)}`).toEqual(expected.state);
        next += 1;
      }
    }
  });
});
