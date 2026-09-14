import { describe, expect, it } from 'vitest';
import {
  isHockeySnapshot,
  createHockey,
  startHockey,
  step,
  NO_INPUT,
  botInput,
  type HockeyState,
} from '../src/index';
const playing = (): HockeyState => ({ ...createHockey(), phase: 'playing' });
describe('Ice Clash physics', () => {
  it('accelerates progressively, glides, and takes time to reverse', () => {
    let state = playing();
    state = step(state, [{ x: 1, y: 0, shoot: false }, NO_INPUT]);
    const first = state.players[0]?.vx ?? 0;
    for (let i = 0; i < 12; i++) state = step(state, [{ x: 1, y: 0, shoot: false }, NO_INPUT]);
    const speed = state.players[0]?.vx ?? 0;
    expect(speed).toBeGreaterThan(first);
    const coast = step(state, [NO_INPUT, NO_INPUT]);
    expect(coast.players[0]?.vx).toBeCloseTo(speed * 0.96);
    const reverse = step(coast, [{ x: -1, y: 0, shoot: false }, NO_INPUT]);
    expect(reverse.players[0]?.vx).toBeGreaterThan(0);
  });
  it('steals on close overlap and prevents instant repeated transfers', () => {
    const state = playing();
    state.players[0] = {
      ...state.players[0],
      x: 490,
      y: 300,
      vx: 0,
      vy: 0,
      dx: 1,
      dy: 0,
      cooldown: 0,
      charge: 0,
      down: 0,
      swing: 0,
      swingPower: 0,
    };
    state.players[1] = {
      ...state.players[1],
      x: 515,
      y: 300,
      vx: 0,
      vy: 0,
      dx: -1,
      dy: 0,
      cooldown: 0,
      charge: 0,
      down: 0,
      swing: 0,
      swingPower: 0,
    };
    state.puck = { x: 520, y: 300, vx: 0, vy: 0, owner: 0, lock: 0 };
    const next = step(state, [NO_INPUT, NO_INPUT]);
    expect(next.puck.owner).toBe(1);
    expect(step(next, [NO_INPUT, NO_INPUT]).puck.owner).toBe(1);
    expect(state.puck.owner).toBe(0);
  });
  it('uses low puck friction and elastic boards', () => {
    const state = playing();
    state.puck = { x: 500, y: 50, vx: 4, vy: -12, owner: -1, lock: 30 };
    const next = step(state, [NO_INPUT, NO_INPUT]);
    expect(next.puck.vx).toBeCloseTo(3.96);
    expect(next.puck.vy).toBeCloseTo(12 * 0.99 * 0.85);
    expect(next.puck.y).toBe(47);
  });
  it('keeps a held puck behind its target briefly, then releases a high-speed shot', () => {
    const state = playing();
    state.puck = { x: 340, y: 300, vx: 0, vy: 0, owner: 0, lock: 30 };
    const next = step(state, [NO_INPUT, NO_INPUT]);
    expect(next.puck.x).toBeGreaterThan(340);
    expect(next.puck.x).toBeLessThan(369);
    const fired = step(next, [{ ...NO_INPUT, shoot: true }, NO_INPUT]);
    expect(fired.puck.owner).toBe(-1);
    expect(fired.puck.vx).toBeGreaterThan(11);
  });
  it('scores only inside the goal mouth, resets at center, and finishes at five', () => {
    const state = playing();
    state.scores = [4, 0];
    state.puck = { x: 960, y: 228, vx: 15, vy: 0, owner: -1, lock: 30 };
    const goal = step(state, [NO_INPUT, NO_INPUT]);
    expect(goal.phase).toBe('finished');
    expect(goal.winner).toBe(0);
    expect(goal.scores).toEqual([5, 0]);
    expect(goal.puck.x).toBe(500);
    const blocked = step({ ...state, puck: { ...state.puck, y: 100 } }, [NO_INPUT, NO_INPUT]);
    expect(blocked.scores).toEqual([4, 0]);
    expect(blocked.puck.vx).toBeLessThan(0);
  });
  it('keeps automatic goalkeepers on their fixed axes and inside the crease', () => {
    let state = playing();
    state.puck = { x: 500, y: 100, vx: 0, vy: 0, owner: -1, lock: 1000 };
    for (let i = 0; i < 120; i++) state = step(state, [NO_INPUT, NO_INPUT]);
    expect(state.goalies.every((y) => y >= 236 && y <= 364)).toBe(true);
  });
  it('plays a complete AI match without a physics deadlock', () => {
    let state = startHockey(createHockey());
    for (let i = 0; i < 18000 && state.phase !== 'finished'; i++)
      state = step(state, [botInput(state, 0, 'extra-hard'), botInput(state, 1, 'hard')]);
    expect(state.phase).toBe('finished');
    expect(Math.max(...state.scores)).toBe(5);
  });
});

describe('hockey snapshot validation', () => {
  it('rejects malformed puck coordinates and non-finite simulation counters', () => {
    const snapshot = {
      version: 2,
      state: createHockey(),
      seat: 0,
      names: ['Home', 'Away'],
      connected: [true, true],
    };
    expect(isHockeySnapshot(snapshot)).toBe(true);
    expect(isHockeySnapshot({ ...snapshot, state: { ...snapshot.state, puck: {} } })).toBe(false);
    expect(isHockeySnapshot({ ...snapshot, state: { ...snapshot.state, tick: Infinity } })).toBe(
      false,
    );
    expect(
      isHockeySnapshot({
        ...snapshot,
        state: { ...snapshot.state, puck: { ...snapshot.state.puck, owner: 8 } },
      }),
    ).toBe(false);
  });
});

describe('charged strikes and protected possession', () => {
  it('cannot steal through the carrier’s back or protected side', () => {
    for (const [x, y] of [
      [465, 300],
      [490, 325],
    ]) {
      const state = playing();
      Object.assign(state.players[0] ?? {}, { x: 490, y: 300, dx: 1, dy: 0 });
      Object.assign(state.players[1] ?? {}, { x, y });
      state.puck = { x: 519, y: 300, vx: 0, vy: 0, owner: 0, lock: 0 };
      expect(step(state, [NO_INPUT, NO_INPUT]).puck.owner).toBe(0);
    }
  });
  it('caps charging at 1.5 seconds, increases shot speed, and animates the release', () => {
    let state = playing();
    state.puck.owner = 0;
    const tap = step(state, [{ ...NO_INPUT, shoot: true }, NO_INPUT]);
    for (let i = 0; i < 90; i++) state = step(state, [{ ...NO_INPUT, charging: true }, NO_INPUT]);
    expect(state.players[0]?.charge).toBeCloseTo(1);
    for (let i = 0; i < 30; i++) state = step(state, [{ ...NO_INPUT, charging: true }, NO_INPUT]);
    expect(state.players[0]?.charge).toBe(1);
    const fired = step(state, [{ ...NO_INPUT, shoot: true }, NO_INPUT]);
    expect(fired.puck.vx).toBeGreaterThan(tap.puck.vx * 2);
    expect(fired.players[0]?.charge).toBe(0);
    expect(fired.players[0]?.swingPower).toBe(1);
    expect(fired.players[0]?.swing).toBeGreaterThan(tap.players[0]?.swing ?? 0);
  });
  it('knocks for at most 0.3 seconds and preserves the victim’s slowing momentum', () => {
    const hit = (power: number) => {
      const state = playing();
      Object.assign(state.players[0] ?? {}, { x: 400, y: 300, charge: power, dx: 1, dy: 0 });
      Object.assign(state.players[1] ?? {}, { x: 443, y: 300, vx: 2, vy: 1 });
      state.puck = { x: 472, y: 300, vx: 2, vy: 1, owner: 1, lock: 0 };
      return step(state, [{ ...NO_INPUT, shoot: true }, NO_INPUT]);
    };
    expect(hit(0).players[1]?.down).toBe(6);
    let state = hit(1);
    expect(state.players[1]?.down).toBe(18);
    expect(state.puck.owner).toBe(-1);
    const old = state.players[1];
    state = step(state, [NO_INPUT, { x: -1, y: -1, shoot: true, charging: true }]);
    expect(state.players[1]?.vx).toBeCloseTo((old?.vx ?? 0) * 0.96);
    expect(state.players[1]?.vy).toBeCloseTo((old?.vy ?? 0) * 0.96);
    expect(state.players[1]?.x).toBeGreaterThan(old?.x ?? 0);
    expect(state.players[1]?.charge).toBe(0);
    expect(state.players[1]?.swing).toBe(0);
    for (let i = 0; i < 18; i++) state = step(state, [NO_INPUT, NO_INPUT]);
    expect(state.players[1]?.down).toBe(0);
  });
  it('cannot knock someone behind the stick or collect the puck while down', () => {
    const state = playing();
    Object.assign(state.players[0] ?? {}, { x: 400, y: 300, dx: 1, dy: 0, charge: 1 });
    Object.assign(state.players[1] ?? {}, { x: 355, y: 300 });
    const next = step(state, [{ ...NO_INPUT, shoot: true }, NO_INPUT]);
    expect(next.players[1]?.down).toBe(0);
    Object.assign(next.players[1] ?? {}, { down: 18 });
    next.puck = { x: 355, y: 300, vx: 0, vy: 0, owner: -1, lock: 0 };
    expect(step(next, [NO_INPUT, NO_INPUT]).puck.owner).toBe(-1);
  });
});
