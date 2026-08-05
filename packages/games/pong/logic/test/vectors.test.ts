import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PaddleInput, PongState } from '../src/state.ts';
import { step } from '../src/step.ts';

interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly inputs: string[];
  readonly checkpoints: { readonly tick: number; readonly state: PongState }[];
}

interface Vectors {
  readonly tickRate: number;
  readonly scenarios: Scenario[];
}

// Reading a fixture the sibling generator wrote. The Go conformance test
// decodes the same file into its own structs; this is the TypeScript half of
// that same trust.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('../testdata/vectors.json', import.meta.url)), 'utf8'),
) as Vectors;

function decode(symbol: string): PaddleInput {
  return { up: symbol === 'u' || symbol === 'b', down: symbol === 'd' || symbol === 'b' };
}

/**
 * Replays the recorded scenarios and checks every checkpoint.
 *
 * These same vectors are replayed by the Go implementation on the server. That
 * is the point of them: the rules exist twice, and nothing else would catch the
 * two drifting apart. A failure here means either a deliberate rule change —
 * regenerate with `pnpm --filter @littlegames/pong-logic vectors` and read the
 * diff — or an accidental one.
 */
describe('conformance vectors', () => {
  it('covers a full match played to the winning score', () => {
    const shutout = vectors.scenarios.find((scenario) => scenario.name === 'shutout');
    const final = shutout?.checkpoints.at(-1)?.state;

    expect(final?.phase).toBe('finished');
    expect(final?.winner).toBe('right');
  });

  for (const scenario of vectors.scenarios) {
    it(`replays "${scenario.name}" exactly`, () => {
      const first = scenario.checkpoints.at(0);
      if (first === undefined) {
        throw new Error(`scenario "${scenario.name}" has no checkpoints`);
      }
      expect(first.tick).toBe(0);

      let state: PongState = first.state;
      let checkpointIndex = 1;

      for (const [tick, symbols] of scenario.inputs.entries()) {
        state = step(state, {
          left: decode(symbols.slice(0, 1)),
          right: decode(symbols.slice(1, 2)),
        });

        const expected = scenario.checkpoints[checkpointIndex];
        if (expected !== undefined && expected.tick === tick + 1) {
          expect(state, `${scenario.name} diverged at tick ${String(tick + 1)}`).toEqual(
            expected.state,
          );
          checkpointIndex += 1;
        }
      }
    });
  }
});
