// Regenerates the conformance vectors both implementations are checked against.
//
// The rules exist twice: here in TypeScript, and in Go on the authoritative
// server. Two implementations of the same rules drift. These vectors are the
// contract that catches it — TypeScript is the reference and writes them, Go
// replays them and must land on the same state.
//
// Run with `pnpm --filter @littlegames/battleship-logic vectors` after any rules
// change, and read the diff before committing.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SHIP_LENGTHS } from '../src/constants.ts';
import { fire, placeFleet } from '../src/shots.ts';
import { createInitialState, startPlacement } from '../src/state.ts';
import type { BattleshipState, Placement, Side } from '../src/state.ts';

type Action =
  | { readonly kind: 'place'; readonly side: Side; readonly fleet: Placement[] }
  | { readonly kind: 'fire'; readonly side: Side; readonly row: number; readonly column: number };

/** Ships on alternate rows, hard against the left edge. */
const LEFT_FLEET: Placement[] = SHIP_LENGTHS.map((_, index) => ({
  row: index * 2,
  column: 0,
  orientation: 'horizontal' as const,
}));

/** The same fleet turned on its side, so the two boards differ. */
const TOP_FLEET: Placement[] = SHIP_LENGTHS.map((_, index) => ({
  row: 0,
  column: index * 2,
  orientation: 'vertical' as const,
}));

const actions: Action[] = [
  { kind: 'place', side: 'a', fleet: LEFT_FLEET },
  { kind: 'place', side: 'b', fleet: TOP_FLEET },
];

let state: BattleshipState = startPlacement(createInitialState());
const checkpoints: { step: number; state: BattleshipState }[] = [{ step: 0, state }];
const applied: Action[] = [];

const apply = (action: Action): void => {
  state =
    action.kind === 'place'
      ? placeFleet(state, action.side, action.fleet).state
      : fire(state, action.side, { row: action.row, column: action.column }).state;
  applied.push(action);
  if (applied.length % 10 === 0) {
    checkpoints.push({ step: applied.length, state });
  }
};

for (const action of actions) {
  apply(action);
}

// Each side sweeps the board in its own direction, and only ever when the turn
// is actually theirs. Firing blind would have most shots refused as out of
// turn, and a run that never reaches a win never tests winning.
const next: Record<Side, number> = { a: 0, b: 0 };
const cellFor = (side: Side, index: number) => ({
  row: side === 'a' ? Math.floor(index / 10) : 9 - Math.floor(index / 10),
  column: side === 'a' ? index % 10 : 9 - (index % 10),
});

// A ceiling, so a rules change that makes a game unwinnable fails here rather
// than looping for ever.
for (let guard = 0; guard < 400 && state.phase === 'playing'; guard += 1) {
  const side = state.turn;
  if (next[side] >= 100) {
    break;
  }
  apply({ kind: 'fire', side, ...cellFor(side, next[side]) });
  next[side] += 1;
}

// One shot after the end, to pin down that a finished game refuses them.
apply({ kind: 'fire', side: 'a', row: 0, column: 0 });

checkpoints.push({ step: applied.length, state });

const target = fileURLToPath(new URL('../testdata/vectors.json', import.meta.url));
writeFileSync(
  target,
  `${JSON.stringify(
    { generatedBy: 'packages/games/battleship/logic/scripts/write-vectors.ts', actions: applied, checkpoints },
    null,
    2,
  )}\n`,
);

const last = checkpoints.at(-1)?.state;
console.log(`${String(applied.length)} actions, final phase ${last?.phase ?? '?'}, winner ${last?.winner ?? 'none'}`);
console.log(`written to ${target}`);
