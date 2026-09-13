export const TICK_RATE = 60;
export const WIN_SCORE = 5;
export interface Skater {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dx: number;
  dy: number;
  cooldown: number;
}
export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  lock: number;
}
export interface HockeyState {
  tick: number;
  phase: 'waiting' | 'faceoff' | 'playing' | 'finished';
  countdown: number;
  players: Skater[];
  puck: Puck;
  goalies: number[];
  scores: number[];
  winner: number;
  goal: number;
}
export interface HockeyInput {
  x: number;
  y: number;
  shoot: boolean;
}
export const NO_INPUT: HockeyInput = { x: 0, y: 0, shoot: false };
export function createHockey(): HockeyState {
  return {
    tick: 0,
    phase: 'waiting',
    countdown: 90,
    players: [
      { x: 340, y: 300, vx: 0, vy: 0, dx: 1, dy: 0, cooldown: 0 },
      { x: 660, y: 300, vx: 0, vy: 0, dx: -1, dy: 0, cooldown: 0 },
    ],
    puck: { x: 500, y: 300, vx: 0, vy: 0, owner: -1, lock: 0 },
    goalies: [300, 300],
    scores: [0, 0],
    winner: -1,
    goal: -1,
  };
}
export function startHockey(state: HockeyState): HockeyState {
  return { ...state, phase: 'faceoff', countdown: 90 };
}
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
/** One simulation tick is 1/60 second. Both browser and server use the same coefficients. */
export function step(state: HockeyState, inputs: readonly HockeyInput[]): HockeyState {
  if (state.phase === 'waiting' || state.phase === 'finished') return state;
  const next: HockeyState = {
    ...state,
    tick: state.tick + 1,
    players: state.players.map((player) => ({ ...player })),
    puck: { ...state.puck },
    goalies: [...state.goalies],
    scores: [...state.scores],
  };
  if (next.phase === 'faceoff') {
    next.countdown--;
    if (next.countdown <= 0) next.phase = 'playing';
    return next;
  }
  for (let i = 0; i < 2; i++) {
    const player = next.players[i];
    if (!player) continue;
    const input = inputs[i] ?? NO_INPUT;
    let x = Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0,
      y = Number.isFinite(input.y) ? clamp(input.y, -1, 1) : 0;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    player.vx = (player.vx + x * 0.42) * 0.96;
    player.vy = (player.vy + y * 0.42) * 0.96;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed > 5.5) {
      player.vx = (player.vx / speed) * 5.5;
      player.vy = (player.vy / speed) * 5.5;
    }
    player.x = clamp(player.x + player.vx, 58, 942);
    player.y = clamp(player.y + player.vy, 68, 532);
    if (player.x === 58 || player.x === 942) player.vx *= 0.4;
    if (player.y === 68 || player.y === 532) player.vy *= 0.4;
    if (length > 0.05) {
      player.dx = x / Math.max(length, 1);
      player.dy = y / Math.max(length, 1);
      const facing = Math.hypot(player.dx, player.dy);
      if (facing > 0) {
        player.dx /= facing;
        player.dy /= facing;
      }
    }
    player.cooldown = Math.max(0, player.cooldown - 1);
  }
  const puck = next.puck;
  puck.lock = Math.max(0, puck.lock - 1);
  const a = next.players[0],
    b = next.players[1];
  if (a && b) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      distance = Math.hypot(dx, dy);
    // Steal before separating bodies: a close physical interception transfers possession.
    if (distance < 36 && puck.owner >= 0 && puck.lock === 0) {
      puck.owner = 1 - puck.owner;
      puck.lock = 25;
    }
    if (distance < 36) {
      const nx = distance > 0.001 ? dx / distance : 1,
        ny = distance > 0.001 ? dy / distance : 0,
        overlap = (36 - distance) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      a.vx -= nx * 0.3;
      a.vy -= ny * 0.3;
      b.vx += nx * 0.3;
      b.vy += ny * 0.3;
    }
  }
  for (let i = 0; i < 2; i++) {
    const player = next.players[i],
      input = inputs[i] ?? NO_INPUT;
    if (!player) continue;
    if (input.shoot && player.cooldown === 0) {
      player.cooldown = 24;
      if (
        puck.owner === i ||
        (puck.owner === -1 && Math.hypot(puck.x - player.x, puck.y - player.y) < 47)
      ) {
        puck.owner = -1;
        puck.lock = 18;
        puck.x = player.x + player.dx * 33;
        puck.y = player.y + player.dy * 33;
        puck.vx = player.dx * 16 + player.vx * 0.4;
        puck.vy = player.dy * 16 + player.vy * 0.4;
      }
    }
  }
  if (puck.owner >= 0) {
    const owner = next.players[puck.owner];
    if (owner) {
      const tx = owner.x + owner.dx * 29,
        ty = owner.y + owner.dy * 29;
      puck.vx = (tx - puck.x) * 0.36;
      puck.vy = (ty - puck.y) * 0.36;
      puck.x += puck.vx;
      puck.y += puck.vy;
    }
  } else {
    puck.vx *= 0.99;
    puck.vy *= 0.99;
    puck.x += puck.vx;
    puck.y += puck.vy;
  }
  for (let i = 0; i < 2; i++) {
    const gy = next.goalies[i] ?? 300;
    next.goalies[i] = gy + clamp(puck.y - gy, -2.1, 2.1);
    next.goalies[i] = clamp(next.goalies[i] ?? 300, 236, 364);
    const gx = i === 0 ? 76 : 924,
      dy = puck.y - (next.goalies[i] ?? 300),
      dx = puck.x - gx,
      distance = Math.hypot(dx, dy);
    if (distance < 29) {
      const nx = distance > 0.001 ? dx / distance : i === 0 ? 1 : -1,
        ny = distance > 0.001 ? dy / distance : 0;
      const dot = puck.vx * nx + puck.vy * ny;
      puck.x = gx + nx * 30;
      puck.y = (next.goalies[i] ?? 300) + ny * 30;
      puck.vx = (puck.vx - 2 * dot * nx) * 0.85 + nx * 2;
      puck.vy = (puck.vy - 2 * dot * ny) * 0.85 + ny * 2;
      puck.owner = -1;
      puck.lock = 12;
    }
  }
  if (puck.y < 47 || puck.y > 553) {
    puck.y = clamp(puck.y, 47, 553);
    puck.vy = -puck.vy * 0.85;
  }
  if (puck.x < 37 || puck.x > 963) {
    if (puck.y > 225 && puck.y < 375) {
      const scorer = puck.x > 963 ? 0 : 1;
      next.scores[scorer] = (next.scores[scorer] ?? 0) + 1;
      const fresh = createHockey();
      return {
        ...fresh,
        tick: next.tick,
        scores: next.scores,
        goal: scorer,
        phase: (next.scores[scorer] ?? 0) >= WIN_SCORE ? 'finished' : 'faceoff',
        countdown: 120,
        winner: (next.scores[scorer] ?? 0) >= WIN_SCORE ? scorer : -1,
      };
    }
    puck.x = clamp(puck.x, 37, 963);
    puck.vx = -puck.vx * 0.85;
  }
  if (puck.owner === -1 && puck.lock === 0) {
    let closest = 31;
    for (let i = 0; i < 2; i++) {
      const player = next.players[i];
      if (!player) continue;
      const distance = Math.hypot(player.x - puck.x, player.y - puck.y);
      if (distance < closest) {
        puck.owner = i;
        closest = distance;
        puck.lock = 15;
      }
    }
  }
  return next;
}
export function botInput(
  state: HockeyState,
  seat: number,
  difficulty: 'easy' | 'hard' | 'extra-hard',
): HockeyInput {
  const player = state.players[seat];
  if (!player) return NO_INPUT;
  const puck = state.puck,
    owns = puck.owner === seat;
  let tx = puck.x,
    ty = puck.y;
  if (owns) {
    tx = seat === 0 ? 855 : 145;
    ty = 300 + (state.tick % 240 < 120 ? -60 : 60);
  } else if (difficulty !== 'easy') {
    const carrier = state.players[puck.owner];
    tx = carrier ? carrier.x + carrier.vx * 7 : puck.x + puck.vx * 8;
    ty = carrier ? carrier.y + carrier.vy * 7 : puck.y + puck.vy * 8;
  }
  const dx = tx - player.x,
    dy = ty - player.y,
    length = Math.hypot(dx, dy) || 1,
    speed = difficulty === 'easy' ? 0.68 : difficulty === 'hard' ? 0.88 : 1;
  const nearGoal = seat === 0 ? player.x > 650 : player.x < 350;
  if (owns && nearGoal && Math.abs(player.y - 300) < 120) {
    const goalX = seat === 0 ? 967 : 33,
      goalY = state.tick % 160 < 80 ? 239 : 361,
      gx = goalX - player.x,
      gy = goalY - player.y,
      gl = Math.hypot(gx, gy);
    return {
      x: (gx / gl) * speed,
      y: (gy / gl) * speed,
      shoot: state.tick % (difficulty === 'easy' ? 50 : difficulty === 'hard' ? 25 : 12) === 0,
    };
  }
  return { x: (dx / length) * speed, y: (dy / length) * speed, shoot: false };
}
export interface HockeySnapshot {
  version: number;
  state: HockeyState;
  seat: number;
  names: string[];
  connected: boolean[];
}
export function isHockeySnapshot(value: unknown): value is HockeySnapshot {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('state' in value) ||
    typeof value.state !== 'object' ||
    !value.state ||
    !('version' in value) ||
    value.version !== 1 ||
    !('seat' in value) ||
    (value.seat !== 0 && value.seat !== 1)
  )
    return false;
  const s = value.state;
  const puck = 'puck' in s ? s.puck : null;
  return (
    'players' in s &&
    Array.isArray(s.players) &&
    s.players.length === 2 &&
    s.players.every(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        ['x', 'y', 'vx', 'vy', 'dx', 'dy', 'cooldown'].every(
          (key) => typeof p[key] === 'number' && Number.isFinite(p[key]),
        ),
    ) &&
    'puck' in s &&
    typeof s.puck === 'object' &&
    s.puck !== null &&
    ['x', 'y', 'vx', 'vy', 'owner', 'lock'].every((key) =>
      Number.isFinite(
        typeof puck === 'object' && puck !== null ? Reflect.get(puck, key) : undefined,
      ),
    ) &&
    'owner' in s.puck &&
    [-1, 0, 1].includes(Number(s.puck.owner)) &&
    'scores' in s &&
    Array.isArray(s.scores) &&
    s.scores.length === 2 &&
    s.scores.every(Number.isFinite) &&
    'goalies' in s &&
    Array.isArray(s.goalies) &&
    s.goalies.length === 2 &&
    s.goalies.every(Number.isFinite) &&
    'phase' in s &&
    ['waiting', 'faceoff', 'playing', 'finished'].includes(String(s.phase)) &&
    'tick' in s &&
    typeof s.tick === 'number' &&
    Number.isInteger(s.tick) &&
    s.tick >= 0 &&
    'countdown' in s &&
    typeof s.countdown === 'number' &&
    Number.isInteger(s.countdown) &&
    s.countdown >= 0 &&
    'winner' in s &&
    typeof s.winner === 'number' &&
    [-1, 0, 1].includes(s.winner) &&
    'goal' in s &&
    typeof s.goal === 'number' &&
    [-1, 0, 1].includes(s.goal) &&
    'names' in value &&
    Array.isArray(value.names) &&
    value.names.length === 2 &&
    value.names.every((name) => typeof name === 'string') &&
    'connected' in value &&
    Array.isArray(value.connected) &&
    value.connected.length === 2 &&
    value.connected.every((item) => typeof item === 'boolean')
  );
}
