import { describe, expect, it } from 'vitest';
import { emptyFleetView } from '../src/features/fleet/fleet-view';
import { initialPresentation, presentationReducer } from '../src/features/fleet/fleet-presentation';
import {
  createFleetRound,
  deployPracticeFleet,
  firePracticeShot,
  practiceFleetView,
} from '../src/features/practice/fleet-practice-state';
import { cellsOf, shipLength, type BattleshipView } from '@littlegames/battleship-logic';

const playing: BattleshipView = { ...emptyFleetView(), phase: 'playing', yourTurn: true };
const first: BattleshipView = {
  ...playing,
  yourTurn: false,
  outgoing: [{ row: 0, column: 0, result: 'miss' }],
};
const second: BattleshipView = { ...first, incoming: [{ row: 1, column: 2, result: 'hit' }] };
describe('Fleet combat presentation', () => {
  it('withholds the result until impact and orders both directions without losing a shot', () => {
    let state = presentationReducer(initialPresentation(playing), { type: 'receive', view: first });
    expect(state.view.outgoing).toHaveLength(0);
    expect(state.active?.direction).toBe('outgoing');
    state = presentationReducer(state, { type: 'receive', view: second });
    expect(state.queue).toHaveLength(1);
    state = presentationReducer(state, { type: 'advance' });
    expect(state.view.outgoing).toHaveLength(1);
    expect(state.view.incoming).toHaveLength(0);
    expect(state.active?.phase).toBe('impact');
    state = presentationReducer(state, { type: 'advance' });
    expect(state.active?.direction).toBe('incoming');
    state = presentationReducer(state, { type: 'advance' });
    expect(state.view.incoming).toHaveLength(1);
    state = presentationReducer(state, { type: 'advance' });
    expect(state.active).toBeNull();
    expect(state.view).toBe(second);
  });
  it('does not replay historical shots after reconnect and clears effects on restart', () => {
    const restored = presentationReducer(initialPresentation(emptyFleetView()), {
      type: 'receive',
      view: second,
    });
    expect(restored.active).toBeNull();
    expect(restored.view).toBe(second);
    let state = presentationReducer(initialPresentation(playing), { type: 'receive', view: first });
    state = presentationReducer(state, { type: 'receive', view: emptyFleetView() });
    expect(state.active).toBeNull();
    expect(state.queue).toHaveLength(0);
  });
  it('retains status updates received during an animation without disclosing its result early', () => {
    let state = presentationReducer(initialPresentation(playing), { type: 'receive', view: first });
    const disconnected = { ...first, opponentPresent: false };
    state = presentationReducer(state, { type: 'receive', view: disconnected });
    expect(state.view.outgoing).toHaveLength(0);
    state = presentationReducer(state, { type: 'advance' });
    state = presentationReducer(state, { type: 'advance' });
    expect(state.view).toBe(disconnected);
  });
  it('reveals a practice ship only after the last hit, including its original orientation', () => {
    let round = createFleetRound();
    round = deployPracticeFleet(round, round.state.boards.b.fleet);
    expect(practiceFleetView(round).revealedShips).toEqual([]);
    const placement = round.state.boards.b.fleet[0];
    if (!placement) throw new Error('Missing carrier');
    const cells = cellsOf(placement, shipLength(0));
    for (const cell of cells.slice(0, -1)) round = firePracticeShot(round, 'a', cell);
    expect(practiceFleetView(round).revealedShips).toEqual([]);
    const last = cells.at(-1);
    if (!last) throw new Error('Missing last cell');
    round = firePracticeShot(round, 'a', last);
    expect(practiceFleetView(round).revealedShips).toEqual([{ index: 0, placement }]);
  });
});
