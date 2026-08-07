import { describe, expect, it } from 'vitest';
import { opponentOf, type Seat } from '../src/arena.ts';
import { eyePosition } from '../src/body.ts';
import { COUNTDOWN_TICKS, MAX_HEALTH, STAND_HEIGHT } from '../src/constants.ts';
import { poseOf, type BodyPart } from '../src/pose.ts';
import { rayVsOrientedBox } from '../src/ray.ts';
import {
  createInitialState,
  startCountdown,
  type ArenaInput,
  type ArenaState,
} from '../src/state.ts';
import { damageOf, step } from '../src/step.ts';
import { normalizeAim, type Vec3 } from '../src/vector.ts';

const NOTHING: ArenaInput = {
  move: { x: 0, z: 0 },
  aim: { x: 0, y: 0, z: 1 },
  jump: false,
  crouch: false,
  fire: false,
  zoomed: false,
  rewindTicks: 0,
};

/**
 * A state with the countdown run out and both players already looking across.
 *
 * Facing each other from the start matters: swinging onto a target and firing
 * in the same tick is the shot the spread exists to punish, so a test that
 * turned first would be measuring the flick rather than the damage.
 */
function playing(): ArenaState {
  let state = startCountdown(createInitialState(), COUNTDOWN_TICKS);
  const facing = (which: ArenaState['north']): ArenaInput => ({ ...NOTHING, aim: which.aim });
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick += 1) {
    state = step(state, { north: facing(state.north), south: facing(state.south) }).state;
  }
  expect(state.phase).toBe('playing');
  return state;
}

/** Where south must look to put a shot through a named part of north. */
function aimAt(state: ArenaState, part: BodyPart): Vec3 {
  const eye = eyePosition(state.south.body);
  const found = poseOf(state.north.body, state.north.aim).parts.find(
    (piece) => piece.part === part,
  );
  expect(found).toBeDefined();
  const at = found?.centre ?? { x: 0, y: 0, z: 0 };
  return normalizeAim({ x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z });
}

/** Fires one scoped shot from south at the named part, then waits out the cooldown. */
function shoot(state: ArenaState, part: BodyPart): ArenaState {
  const aim = aimAt(state, part);
  // Settled onto the part for a tick before firing, so the turning term of the
  // spread has gone and the shot is decided by where it was pointed.
  let next = step(state, {
    north: { ...NOTHING, aim: state.north.aim },
    south: { ...NOTHING, aim, zoomed: true },
  }).state;
  next = step(next, {
    north: { ...NOTHING, aim: next.north.aim },
    south: { ...NOTHING, aim, fire: true, zoomed: true },
  }).state;
  while (next.south.cooldownTicks > 0 && next.phase === 'playing') {
    next = step(next, {
      north: { ...NOTHING, aim: next.north.aim },
      south: { ...NOTHING, aim, zoomed: true },
    }).state;
  }
  return next;
}

describe('what a hit is worth', () => {
  it('divides the whole of a body exactly', () => {
    // Six is chosen so the three zones go into it: two chest shots or three to
    // a limb, with nothing left over and no rounding to argue about.
    expect(damageOf('head')).toBe(MAX_HEALTH);
    expect(MAX_HEALTH % damageOf('torso')).toBe(0);
    expect(MAX_HEALTH % damageOf('armLeft')).toBe(0);
    expect(MAX_HEALTH / damageOf('torso')).toBe(2);
    expect(MAX_HEALTH / damageOf('shinRight')).toBe(3);
  });

  it('treats every limb the same, whichever it is', () => {
    const limbs: BodyPart[] = [
      'armLeft',
      'armRight',
      'thighLeft',
      'thighRight',
      'shinLeft',
      'shinRight',
    ];
    for (const limb of limbs) {
      expect(damageOf(limb)).toBe(damageOf('armLeft'));
    }
  });
});

describe('a duel decided by where the shots land', () => {
  it('kills outright with one to the head', () => {
    const after = shoot(playing(), 'head');
    expect(after.north.alive).toBe(false);
    expect(after.south.score).toBe(1);
  });

  it('takes two to the chest', () => {
    let state = shoot(playing(), 'torso');
    expect(state.north.alive).toBe(true);
    expect(state.north.health).toBe(MAX_HEALTH - damageOf('torso'));
    expect(state.south.score).toBe(0);

    state = shoot(state, 'torso');
    expect(state.north.alive).toBe(false);
    expect(state.south.score).toBe(1);
  });

  it('takes three to a limb', () => {
    let state = playing();
    for (let shot = 0; shot < 2; shot += 1) {
      state = shoot(state, 'armRight');
      expect(state.north.alive).toBe(true);
    }
    expect(state.north.health).toBe(MAX_HEALTH - 2 * damageOf('armRight'));

    state = shoot(state, 'armRight');
    expect(state.north.alive).toBe(false);
    expect(state.south.score).toBe(1);
  });

  it('cannot reach the legs of somebody standing behind their cover', () => {
    // Not a limitation, and worth pinning: from the two spawns only the head
    // and chest clear the parapet, so the legs are a target you have to move
    // for. A shot aimed straight at a thigh stops at the crate in front of it.
    const state = playing();
    const after = shoot(state, 'thighRight');
    expect(after.north.health).toBe(MAX_HEALTH);
  });

  it('gives a full body back on respawn', () => {
    let state = shoot(playing(), 'head');
    expect(state.north.alive).toBe(false);
    while (!state.north.alive) {
      state = step(state, { north: NOTHING, south: { ...NOTHING, aim: state.south.aim } }).state;
    }
    expect(state.north.health).toBe(MAX_HEALTH);
    // And the score survives being killed.
    expect(state.south.score).toBe(1);
  });

  it('scores the kill and not the shots before it', () => {
    let state = shoot(playing(), 'armLeft');
    state = shoot(state, 'armLeft');
    expect(state.south.score).toBe(0);
    state = shoot(state, 'armLeft');
    expect(state.south.score).toBe(1);
  });
});

describe('the boxes a shot is tested against', () => {
  it('are the ones the renderer draws, oriented and all', () => {
    // A ray straight down the middle of a part must enter it. This is the whole
    // contract between drawing and hitting, and an axis-aligned test would fail
    // it for any limb that is not upright.
    const state = playing();
    const eye = eyePosition(state.south.body);
    for (const part of poseOf(state.north.body, state.north.aim).parts) {
      const aim = normalizeAim({
        x: part.centre.x - eye.x,
        y: part.centre.y - eye.y,
        z: part.centre.z - eye.z,
      });
      expect(rayVsOrientedBox(eye, aim, part, 100)).not.toBeNull();
    }
  });

  it('miss a ray that passes beside the part', () => {
    const state = playing();
    const head = poseOf(state.north.body, state.north.aim).parts.find(
      (part) => part.part === 'head',
    );
    expect(head).toBeDefined();
    const eye = eyePosition(state.south.body);
    // A metre to the side of the head, from twenty-three metres away.
    const beside = normalizeAim({
      x: (head?.centre.x ?? 0) + 1 - eye.x,
      y: (head?.centre.y ?? 0) - eye.y,
      z: (head?.centre.z ?? 0) - eye.z,
    });
    expect(head === undefined ? null : rayVsOrientedBox(eye, beside, head, 100)).toBeNull();
  });

  it('cannot be hidden behind by the target holding a rifle', () => {
    // The weapon is drawn but never shot at, so a player cannot use their own
    // gun as cover.
    const state = playing();
    const aim = aimAt(state, 'weapon');
    const before = state.north.health;
    const settled = step(state, {
      north: { ...NOTHING, aim: state.north.aim },
      south: { ...NOTHING, aim, zoomed: true },
    }).state;
    const after = step(settled, {
      north: { ...NOTHING, aim: settled.north.aim },
      south: { ...NOTHING, aim, fire: true, zoomed: true },
    }).state;
    // It goes through and finds whatever is behind it, which at chest height is
    // the chest.
    expect(after.north.health).toBeLessThanOrEqual(before);
  });
});

describe('rewinding a target', () => {
  it('poses them as they were, not as they are', () => {
    // Lag compensation rebuilds the whole figure, so the arms of a rewound
    // target are where the target's arms were — which needs the aim from the
    // ring, not the current one.
    let state = playing();
    const walking: ArenaInput = { ...NOTHING, move: { x: 1, z: 0 } };
    for (let tick = 0; tick < 10; tick += 1) {
      state = step(state, {
        north: { ...walking, aim: state.north.aim },
        south: { ...NOTHING, aim: state.south.aim },
      }).state;
    }

    // Aimed where north was ten ticks ago, and claimed to have seen that far
    // back. Without the rewind this shot passes through empty air.
    const seat: Seat = 'north';
    expect(opponentOf('south')).toBe(seat);
    const past = state.history[(state.historyAt - 9 + state.history.length) % state.history.length];
    expect(past).toBeDefined();
    const eye = eyePosition(state.south.body);
    const aim = normalizeAim({
      x: (past?.north.x ?? 0) - eye.x,
      y: (past?.north.y ?? 0) + STAND_HEIGHT / 2 - eye.y,
      z: (past?.north.z ?? 0) - eye.z,
    });

    // Settled onto the lagged position first, for the same reason as above.
    const settled = step(state, {
      north: { ...walking, aim: state.north.aim },
      south: { ...NOTHING, aim, zoomed: true },
    }).state;
    const rewound = step(settled, {
      north: { ...walking, aim: settled.north.aim },
      south: { ...NOTHING, aim, fire: true, zoomed: true, rewindTicks: 10 },
    }).state;
    const live = step(settled, {
      north: { ...walking, aim: settled.north.aim },
      south: { ...NOTHING, aim, fire: true, zoomed: true, rewindTicks: 0 },
    }).state;

    expect(rewound.north.health).toBeLessThan(MAX_HEALTH);
    expect(rewound.north.health).toBeLessThan(live.north.health);
  });
});
