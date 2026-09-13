import { describe, expect, it } from 'vitest';
import {
  act,
  createArtillery,
  DEFAULT_OPTIONS,
  MAPS,
  chooseArtilleryShot,
  trajectory,
  tankPosition,
} from '../src/index';
function start(state = createArtillery()) {
  return act(act(state, 0, { type: 'ready' }).state, 1, { type: 'ready' }).state;
}
describe('Pocket Artillery rules', () => {
  it('locks host options and accepts only valid commands on the active turn', () => {
    const initial = createArtillery();
    expect(act(initial, 1, { type: 'configure', options: DEFAULT_OPTIONS }).error).toBeTruthy();
    expect(
      act(initial, 0, { type: 'configure', options: { ...DEFAULT_OPTIONS, health: 0 } }).error,
    ).toBeTruthy();
    const state = start(initial);
    for (const angle of [NaN, Infinity, -1, 180])
      expect(act(state, 0, { type: 'fire', angle, power: 70, weapon: 'shell' }).state).toBe(state);
    expect(
      act(state, 1, { type: 'fire', angle: 135, power: 75, weapon: 'shell' }).error,
    ).toBeTruthy();
    expect(act(state, 0, { type: 'configure', options: DEFAULT_OPTIONS }).error).toBeTruthy();
  });
  it('consumes ammunition and shields once while keeping original state immutable', () => {
    const state = start();
    const protectedState = act(state, 0, { type: 'shield' }).state;
    expect(state.tanks[0]?.shield).toBe(false);
    expect(protectedState.tanks[0]?.shield).toBe(true);
    const aim = chooseArtilleryShot(protectedState, 1, 'extra-hard', () => 0.5);
    const shielded = act(protectedState, 1, aim).state;
    const unshielded = act(
      { ...protectedState, tanks: protectedState.tanks.map((t) => ({ ...t, shield: false })) },
      1,
      aim,
    ).state;
    expect(shielded.lastShot?.damage[0]).toBeLessThan(unshielded.lastShot?.damage[0] ?? 0);
    expect(shielded.tanks[1]?.heavy).toBe(1);
    expect(protectedState.tanks[1]?.heavy).toBe(2);
    expect(act(shielded, 0, { type: 'shield' }).error).toBeTruthy();
  });
  for (const map of MAPS)
    it(`plays a full ${map} match, alternates opening turns, and ends`, () => {
      let state = start(createArtillery({ ...DEFAULT_OPTIONS, map, bestOf: 3 }));
      let actions = 0;
      while (state.phase !== 'finished' && actions++ < 150) {
        if (state.phase === 'round-over') {
          const round = state.round;
          state = start(state);
          expect(state.turn).toBe(round % 2);
          expect(state.tanks[0]?.heavy).toBe(2);
        } else {
          const result = act(
            state,
            state.turn,
            chooseArtilleryShot(state, state.turn, 'extra-hard', () => 0.5),
          );
          expect(result.error).toBeNull();
          state = result.state;
        }
      }
      expect(state.phase).toBe('finished');
      expect(state.scores[state.winner]).toBe(2);
    });
  it('changes flight with wind, gravity, and angle while producing bounded paths', () => {
    const state = start(),
      shot = trajectory(state, 0, 45, 75);
    expect(shot.path.length).toBeLessThanOrEqual(402);
    expect(trajectory({ ...state, wind: 30 }, 0, 45, 75).impact.x).not.toBe(shot.impact.x);
    expect(
      trajectory(start(createArtillery({ ...DEFAULT_OPTIONS, map: 'moon' })), 0, 45, 75).impact.x,
    ).not.toBe(shot.impact.x);
    const target = tankPosition('mesa', 1);
    expect(target.x).toBe(1080);
  });
  it('resolves turn limits without an endless round', () => {
    const state = { ...start(), turns: 59 };
    const next = act(state, 0, { type: 'pass' }).state;
    expect(next.phase).toBe('round-over');
    expect(next.winner).toBe(-1);
  });
});
