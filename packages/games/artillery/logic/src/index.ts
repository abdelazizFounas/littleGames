export type Battlefield = 'mesa' | 'alpine' | 'moon';
export type Weapon = 'shell' | 'heavy' | 'scatter';
export interface Options {
  map: Battlefield;
  bestOf: number;
  health: number;
  wind: number;
  turnSeconds: number;
}
export const DEFAULT_OPTIONS: Options = {
  map: 'mesa',
  bestOf: 3,
  health: 100,
  wind: 1,
  turnSeconds: 30,
};
export const MAPS: readonly Battlefield[] = ['mesa', 'alpine', 'moon'];
export const WEAPONS: Record<
  Weapon,
  { name: string; radius: number; damage: number; description: string }
> = {
  shell: {
    name: 'Standard shell',
    radius: 76,
    damage: 55,
    description: 'Reliable splash damage · Unlimited',
  },
  heavy: {
    name: 'Heavy rocket',
    radius: 110,
    damage: 75,
    description: 'A bigger blast · 2 per round',
  },
  scatter: {
    name: 'Scatter shell',
    radius: 145,
    damage: 42,
    description: 'Wide splash, lighter damage · 2 per round',
  },
};
export interface Point {
  x: number;
  y: number;
}
export interface Tank {
  health: number;
  heavy: number;
  scatter: number;
  shield: boolean;
  shieldUsed: boolean;
}
export interface Shot {
  id: number;
  player: number;
  weapon: Weapon;
  angle: number;
  power: number;
  path: Point[];
  impact: Point;
  damage: number[];
}
export interface ArtilleryState {
  options: Options;
  phase: 'setup' | 'playing' | 'round-over' | 'finished';
  round: number;
  turn: number;
  turns: number;
  revision: number;
  wind: number;
  tanks: Tank[];
  scores: number[];
  ready: boolean[];
  winner: number;
  lastShot: Shot | null;
}
export type Action =
  | { type: 'configure'; options: Options }
  | { type: 'ready' }
  | { type: 'fire'; angle: number; power: number; weapon: Weapon }
  | { type: 'shield' }
  | { type: 'pass' };
const HEIGHTS: Record<Battlefield, readonly number[]> = {
  mesa: [430, 425, 470, 495, 445, 385, 430, 490, 460, 415, 425],
  alpine: [470, 425, 475, 390, 345, 310, 365, 405, 480, 425, 465],
  moon: [445, 425, 475, 480, 450, 475, 455, 475, 470, 425, 445],
};
export function terrain(map: Battlefield, x: number): number {
  const at = Math.max(0, Math.min(9.99999, x / 120));
  const index = Math.floor(at),
    heights = HEIGHTS[map];
  const left = heights[index] ?? 425,
    right = heights[index + 1] ?? left;
  return left + (right - left) * (at - index);
}
export function tankPosition(map: Battlefield, player: number): Point {
  const x = player === 0 ? 120 : 1080;
  return { x, y: terrain(map, x) - 13 };
}
export function validOptions(options: Options): boolean {
  return (
    MAPS.includes(options.map) &&
    [1, 3, 5].includes(options.bestOf) &&
    [100, 150].includes(options.health) &&
    [0, 1, 2].includes(options.wind) &&
    [20, 30, 45].includes(options.turnSeconds)
  );
}
export function windFor(round: number, turns: number, strength: number): number {
  return (((round * 17 + turns * 13) % 31) - 15) * strength;
}
function freshTank(health: number): Tank {
  return { health, heavy: 2, scatter: 2, shield: false, shieldUsed: false };
}
export function createArtillery(options: Options = DEFAULT_OPTIONS): ArtilleryState {
  if (!validOptions(options)) throw new Error('Invalid match options.');
  return {
    options: { ...options },
    phase: 'setup',
    round: 1,
    turn: 0,
    turns: 0,
    revision: 0,
    wind: windFor(1, 0, options.wind),
    tanks: [freshTank(options.health), freshTank(options.health)],
    scores: [0, 0],
    ready: [false, false],
    winner: -1,
    lastShot: null,
  };
}
/** Fixed-step public ballistics, mirrored by Go. Angles are measured counterclockwise from right. */
export function trajectory(
  state: ArtilleryState,
  player: number,
  angle: number,
  power: number,
): { path: Point[]; impact: Point } {
  const origin = tankPosition(state.options.map, player),
    radians = (angle * Math.PI) / 180;
  let x = origin.x + Math.cos(radians) * 30,
    y = origin.y - Math.sin(radians) * 30;
  let vx = Math.cos(radians) * power * 5.5,
    vy = -Math.sin(radians) * power * 5.5;
  const path: Point[] = [{ x, y }],
    gravity = state.options.map === 'moon' ? 110 : 180;
  for (let step = 0; step < 1200; step++) {
    vx += state.wind / 60;
    vy += gravity / 60;
    x += vx / 60;
    y += vy / 60;
    const point = { x, y };
    if (step % 3 === 0) path.push(point);
    const hitTank = [0, 1].some((seat) => {
      const tank = tankPosition(state.options.map, seat);
      return step > 5 && Math.hypot(x - tank.x, y - tank.y) < 23;
    });
    if (x < -100 || x > 1300 || y > 650 || y >= terrain(state.options.map, x) || hitTank) {
      path.push(point);
      return { path, impact: point };
    }
  }
  const impact = { x, y };
  path.push(impact);
  return { path, impact };
}
function endTurn(state: ArtilleryState): ArtilleryState {
  const living = state.tanks
    .map((tank, index) => (tank.health > 0 ? index : -1))
    .filter((index) => index >= 0);
  if (living.length < 2 || state.turns >= 60) {
    const a = state.tanks[0]?.health ?? 0,
      b = state.tanks[1]?.health ?? 0;
    const winner = a === b ? -1 : a > b ? 0 : 1;
    const scores = state.scores.map((score, index) => score + (winner === index ? 1 : 0));
    const finished = scores.some((score) => score >= Math.ceil(state.options.bestOf / 2));
    return {
      ...state,
      scores,
      winner,
      phase: finished ? 'finished' : 'round-over',
      ready: [false, false],
    };
  }
  return {
    ...state,
    turn: 1 - state.turn,
    wind: windFor(state.round, state.turns, state.options.wind),
  };
}
export function act(
  state: ArtilleryState,
  player: number,
  action: Action,
): { state: ArtilleryState; error: string | null } {
  const refuse = (error: string) => ({ state, error });
  if (player !== 0 && player !== 1) return refuse('Unknown commander.');
  if (action.type === 'configure') {
    if (player !== 0 || state.phase !== 'setup' || !validOptions(action.options))
      return refuse('Only the host can configure an unstarted match.');
    return {
      state: { ...createArtillery(action.options), revision: state.revision + 1 },
      error: null,
    };
  }
  if (action.type === 'ready') {
    if (state.phase !== 'setup' && state.phase !== 'round-over')
      return refuse('The round is already running.');
    const ready = state.ready.map((value, index) => value || index === player);
    let next = { ...state, ready, revision: state.revision + 1 };
    if (ready.every(Boolean)) {
      const round = state.round + (state.phase === 'round-over' ? 1 : 0);
      next = {
        ...next,
        round,
        phase: 'playing',
        turn: (round - 1) % 2,
        turns: 0,
        wind: windFor(round, 0, state.options.wind),
        tanks: [freshTank(state.options.health), freshTank(state.options.health)],
        winner: -1,
        lastShot: null,
      };
    }
    return { state: next, error: null };
  }
  if (state.phase !== 'playing' || state.turn !== player) return refuse('Wait for your turn.');
  const tank = state.tanks[player];
  if (!tank) return refuse('Missing tank.');
  if (action.type === 'shield') {
    if (tank.shieldUsed) return refuse('Your shield has already been used this round.');
    const tanks = state.tanks.map((item, index) =>
      index === player ? { ...item, shield: true, shieldUsed: true } : item,
    );
    return {
      state: endTurn({ ...state, tanks, turns: state.turns + 1, revision: state.revision + 1 }),
      error: null,
    };
  }
  if (action.type === 'pass')
    return {
      state: endTurn({ ...state, turns: state.turns + 1, revision: state.revision + 1 }),
      error: null,
    };
  if (
    !Number.isFinite(action.angle) ||
    !Number.isFinite(action.power) ||
    action.angle < 5 ||
    action.angle > 175 ||
    action.power < 10 ||
    action.power > 100 ||
    !Object.hasOwn(WEAPONS, action.weapon)
  )
    return refuse('Choose a valid angle, power, and weapon.');
  if (action.weapon !== 'shell' && tank[action.weapon] <= 0)
    return refuse('That weapon is out of ammunition.');
  const flight = trajectory(state, player, action.angle, action.power),
    weapon = WEAPONS[action.weapon];
  const damage = state.tanks.map((item, index) => {
    const target = tankPosition(state.options.map, index);
    return Math.round(
      weapon.damage *
        Math.max(
          0,
          1 -
            Math.max(0, Math.hypot(flight.impact.x - target.x, flight.impact.y - target.y) - 23) /
              weapon.radius,
        ) *
        (item.shield ? 0.5 : 1),
    );
  });
  const tanks = state.tanks.map((item, index) => ({
    ...item,
    health: Math.max(0, item.health - (damage[index] ?? 0)),
    shield: (damage[index] ?? 0) > 0 ? false : item.shield,
    heavy: item.heavy - (index === player && action.weapon === 'heavy' ? 1 : 0),
    scatter: item.scatter - (index === player && action.weapon === 'scatter' ? 1 : 0),
  }));
  return {
    state: endTurn({
      ...state,
      tanks,
      revision: state.revision + 1,
      turns: state.turns + 1,
      lastShot: {
        ...flight,
        id: state.revision + 1,
        player,
        angle: action.angle,
        power: action.power,
        weapon: action.weapon,
        damage,
      },
    }),
    error: null,
  };
}
export function chooseArtilleryShot(
  state: ArtilleryState,
  player: number,
  difficulty: 'easy' | 'hard' | 'extra-hard',
  random: () => number = Math.random,
): Action {
  const target = tankPosition(state.options.map, 1 - player);
  let best = { angle: player === 0 ? 45 : 135, power: 70, distance: Infinity };
  const increment = difficulty === 'easy' ? 8 : difficulty === 'hard' ? 4 : 2;
  for (let angle = 20; angle <= 160; angle += increment)
    for (let power = 35; power <= 100; power += increment) {
      const { impact } = trajectory(state, player, angle, power);
      const distance = Math.hypot(impact.x - target.x, impact.y - target.y);
      if (distance < best.distance) best = { angle, power, distance };
    }
  const error = difficulty === 'easy' ? 9 : difficulty === 'hard' ? 3 : 0.8;
  return {
    type: 'fire',
    angle: Math.max(5, Math.min(175, best.angle + (random() - 0.5) * error)),
    power: Math.max(10, Math.min(100, best.power + (random() - 0.5) * error)),
    weapon: difficulty !== 'easy' && (state.tanks[player]?.heavy ?? 0) > 0 ? 'heavy' : 'shell',
  };
}
export { isArtillerySnapshot, type ArtillerySnapshot } from './protocol.ts';
