// Node 24 strips the TypeScript types. Keep Go and browser physics on identical fixtures.
import { writeFileSync } from 'node:fs';
import {
  createHockey,
  startHockey,
  step,
  botInput,
  NO_INPUT,
} from '../../packages/games/hockey/logic/src/index.ts';
const vectors = [];
let state = startHockey(createHockey());
for (let tick = 0; tick < 18000 && state.phase !== 'finished'; tick++) {
  const inputs = [botInput(state, 0, 'extra-hard'), botInput(state, 1, 'hard')];
  const after = step(state, inputs);
  if (
    tick % 53 === 0 ||
    after.phase !== state.phase ||
    after.players.some(
      (p, i) => p.down > state.players[i].down || p.swing > state.players[i].swing,
    )
  )
    vectors.push({ before: state, inputs, after });
  state = after;
}
for (const power of [0, 0.5, 1]) {
  const before = { ...createHockey(), phase: 'playing' };
  Object.assign(before.players[0], { x: 400, y: 300, charge: power });
  Object.assign(before.players[1], { x: 443, y: 300, vx: 2, vy: 1 });
  before.puck = { x: 472, y: 300, vx: 2, vy: 1, owner: 1, lock: 0 };
  const inputs = [{ ...NO_INPUT, shoot: true }, NO_INPUT];
  vectors.push({ before, inputs, after: step(before, inputs) });
}
writeFileSync(
  new URL('../../packages/games/hockey/logic/testdata/vectors.json', import.meta.url),
  JSON.stringify(vectors) + '\n',
);
