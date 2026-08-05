// Regenerates the conformance vectors both implementations are checked against.
//
// The physics exists twice: here in TypeScript, and in Go on the authoritative
// server. Two implementations of the same rules drift, and a drift between
// client prediction and server truth shows up as the ball teleporting. These
// vectors are the contract that catches it: TypeScript is the reference and
// writes them, Go replays them and must land on the same numbers.
//
// Run with `pnpm --filter @littlegames/pong-logic vectors` after any change to
// the rules, and read the diff before committing — a change here is a change to
// how the game plays.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NO_INPUT, createInitialState, startCountdown } from '../src/state.ts';
import type { PaddleInput, PongState } from '../src/state.ts';
import { step } from '../src/step.ts';
import { TICK_RATE } from '../src/constants.ts';

const CHECKPOINT_EVERY = 30;

const UP: PaddleInput = { up: true, down: false };
const DOWN: PaddleInput = { up: false, down: true };

/** Inputs are stored per tick, not regenerated, so no pattern has to match. */
function encode(input: PaddleInput): string {
  if (input.up && input.down) {
    return 'b';
  }
  if (input.up) {
    return 'u';
  }
  return input.down ? 'd' : '-';
}

interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly inputs: string[];
  readonly checkpoints: { tick: number; state: PongState }[];
}

function record(
  name: string,
  description: string,
  ticks: number,
  inputsAt: (tick: number, state: PongState) => { left: PaddleInput; right: PaddleInput },
): Scenario {
  let state = startCountdown(createInitialState());
  const inputs: string[] = [];
  const checkpoints: { tick: number; state: PongState }[] = [{ tick: 0, state }];

  for (let tick = 0; tick < ticks; tick += 1) {
    const input = inputsAt(tick, state);
    inputs.push(`${encode(input.left)}${encode(input.right)}`);
    state = step(state, input);
    if ((tick + 1) % CHECKPOINT_EVERY === 0) {
      checkpoints.push({ tick: tick + 1, state });
    }
  }

  checkpoints.push({ tick: ticks, state });
  return { name, description, inputs, checkpoints };
}

const scenarios: Scenario[] = [
  record(
    'rally',
    'Both players chase the ball, so rallies run long and the ball accelerates.',
    1200,
    (_tick, state) => ({
      // A crude tracker on both sides. Good enough to keep the ball alive,
      // which is what exercises deflection, wall bounces and speed gain.
      left: state.ball.y < state.left.y ? UP : DOWN,
      right: state.ball.y < state.right.y ? UP : DOWN,
    }),
  ),
  record(
    'shutout',
    'The left player never moves, so the right player runs the match to its end.',
    3000,
    (_tick, state) => ({
      left: NO_INPUT,
      right: state.ball.y < state.right.y ? UP : DOWN,
    }),
  ),
  record(
    'idle',
    'Nobody touches anything: the countdown runs out and the serve crosses the field.',
    120,
    () => ({ left: NO_INPUT, right: NO_INPUT }),
  ),
];

const output = {
  generatedBy: 'packages/games/pong/logic/scripts/write-vectors.ts',
  tickRate: TICK_RATE,
  checkpointEvery: CHECKPOINT_EVERY,
  scenarios,
};

const target = fileURLToPath(new URL('../testdata/vectors.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);

for (const scenario of scenarios) {
  const last = scenario.checkpoints.at(-1);
  console.log(
    `${scenario.name.padEnd(9)} ${String(scenario.inputs.length).padStart(4)} ticks  ` +
      `final ${last?.state.phase ?? '?'} ${String(last?.state.score.left)}-${String(last?.state.score.right)}`,
  );
}
console.log(`\nwritten to ${target}`);
