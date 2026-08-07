import {
  INTERP_DELAY_TICKS,
  MAX_HEALTH,
  RESPAWN_TICKS,
  SPAWNS,
  TICK_RATE,
  TICK_SECONDS,
  restingBody,
  type PlayerBody,
} from '@littlegames/arena-logic';
import { describe, expect, it } from 'vitest';
import type { ArenaCommand } from '../src/features/game/arena-input-sources';
import {
  CORRECTION_HALF_LIFE_MS,
  DAMAGE_SECONDS,
  HIT_MARKER_SECONDS,
  INTERPOLATION_DELAY_MS,
  TRACER_SECONDS,
  drawableShots,
  fadeSince,
  NO_SMOOTHING,
  SNAP_DISTANCE_METRES,
  composeArenaView,
  eyeOf,
  hudFor,
  interpolateOpponent,
  isContinuous,
  predictSelf,
  smoothCamera,
  type ArenaFrame,
  type FramePlayer,
  type TimedShot,
} from '../src/features/game/arena-view';

function player(over: Partial<FramePlayer> = {}): FramePlayer {
  return {
    seat: 'north',
    body: restingBody(SPAWNS.north),
    aim: { x: 0, y: 0, z: 1 },
    alive: true,
    health: MAX_HEALTH,
    score: 0,
    respawnTicks: 0,
    spawnEpoch: 0,
    ready: true,
    ...over,
  };
}

function frame(over: Partial<ArenaFrame> = {}): ArenaFrame {
  return {
    tick: 0,
    phase: 'playing',
    phaseTicks: 0,
    seat: 'north',
    acknowledgedSeq: 0,
    self: player(),
    opponent: player({ seat: 'south', body: restingBody(SPAWNS.south) }),
    winner: null,
    ...over,
  };
}

function command(over: Partial<ArenaCommand> = {}): ArenaCommand {
  return {
    seq: 1,
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimY: 0,
    aimZ: 8192,
    jump: false,
    crouch: false,
    zoomed: false,
    seenTick: 0,
    shotsFired: 0,
    ...over,
  };
}

describe('the interpolation delay', () => {
  it('is the one the rules declare, not one chosen here', () => {
    // The server adds exactly this to every rewind when it judges a shot. A
    // client drawing further behind than the server compensates would be
    // under-compensated by the difference, and its shots would miss a target
    // that was dead centre on its own screen.
    expect(INTERPOLATION_DELAY_MS).toBe(INTERP_DELAY_TICKS * TICK_SECONDS * 1000);
    expect(INTERPOLATION_DELAY_MS).toBeCloseTo(50, 6);
  });
});

describe('drawing the opponent', () => {
  it('blends between the two snapshots that bracket the moment', () => {
    const from = frame({ opponent: player({ seat: 'south', body: bodyAt(0) }) });
    const to = frame({ opponent: player({ seat: 'south', body: bodyAt(10) }) });

    const halfway = interpolateOpponent(from, to, 0.5);
    expect(halfway?.body.x).toBeCloseTo(5, 9);
  });

  it('refuses to blend across a respawn', () => {
    // A respawn moves a body the length of the arena in one tick. Blending it
    // would slide the opponent back from where they died to their spawn,
    // through every wall in between.
    const before = player({ seat: 'south', body: bodyAt(0), spawnEpoch: 3 });
    const after = player({ seat: 'south', body: bodyAt(20), spawnEpoch: 4 });

    expect(isContinuous(before, after)).toBe(false);
    const drawn = interpolateOpponent(frame({ opponent: before }), frame({ opponent: after }), 0.5);
    expect(drawn?.body.x).toBe(0);
  });

  it('is absent while there is nobody to draw', () => {
    const alone = frame({ opponent: null });
    expect(interpolateOpponent(alone, alone, 0.5)).toBeNull();
    expect(composeArenaView(alone, alone, 0.5, ZERO, FORWARD, 1.4).players).toEqual([]);
  });

  it('never draws this player their own body', () => {
    // The camera is inside it, so it would be a screen full of inside faces.
    const view = composeArenaView(frame(), frame(), 0.5, ZERO, FORWARD, 1.4);
    expect(view.players.every((drawn) => drawn.seat !== 'north')).toBe(true);
  });
});

describe('predicting this player', () => {
  it('replays unacknowledged commands over the server body', () => {
    const authoritative = player({ body: bodyAt(0) });
    const walking = Array.from({ length: 10 }, (_unused, index) =>
      command({ seq: index + 1, moveX: 1024 }),
    );

    const ahead = predictSelf(authoritative, walking);
    expect(ahead.x).toBeGreaterThan(authoritative.body.x);
  });

  it('replays the integers that were sent, not the floats behind them', () => {
    // A wire value of 512 is exactly half deflection, so ten ticks of it move
    // exactly half of what ten ticks of full deflection would. Anything else
    // means prediction is running on numbers the server never saw.
    const half = Array.from({ length: 10 }, (_unused, index) =>
      command({ seq: index + 1, moveX: 512 }),
    );
    const full = Array.from({ length: 10 }, (_unused, index) =>
      command({ seq: index + 1, moveX: 1024 }),
    );

    const start = player({ body: bodyAt(0) });
    const halfWay = predictSelf(start, half).x - start.body.x;
    const fullWay = predictSelf(start, full).x - start.body.x;
    expect(halfWay).toBeCloseTo(fullWay / 2, 12);
  });

  it('leaves a dead player exactly where the server put them', () => {
    // The server ignores a dead player's intent, so predicting movement for
    // one would have the corpse walking away from itself.
    const dead = player({ body: bodyAt(0), alive: false });
    const walking = [command({ seq: 1, moveX: 1024 })];
    expect(predictSelf(dead, walking)).toEqual(dead.body);
  });

  it('is exactly the server body when nothing is pending', () => {
    const authoritative = player({ body: bodyAt(3) });
    expect(predictSelf(authoritative, [])).toEqual(authoritative.body);
  });
});

describe('smoothing the camera', () => {
  it('starts with no offset at all', () => {
    const started = smoothCamera(NO_SMOOTHING, null, { x: 1, y: 2, z: 3 }, 0, 16);
    expect(started.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('carries a small correction and fades it by half every half-life', () => {
    const drawn = { x: 0.2, y: 0, z: 0 };
    const truth = { x: 0, y: 0, z: 0 };

    const immediately = smoothCamera(NO_SMOOTHING, drawn, truth, 0, 0);
    expect(immediately.offset.x).toBeCloseTo(0.2, 9);

    const later = smoothCamera(NO_SMOOTHING, drawn, truth, 0, CORRECTION_HALF_LIFE_MS);
    expect(later.offset.x).toBeCloseTo(0.1, 9);
  });

  it('fades at the same rate whatever the frame rate', () => {
    const drawn = { x: 0.4, y: 0, z: 0 };
    const truth = { x: 0, y: 0, z: 0 };
    // One long frame against two short ones covering the same time.
    const once = smoothCamera(NO_SMOOTHING, drawn, truth, 0, 32).offset.x;
    const first = smoothCamera(NO_SMOOTHING, drawn, truth, 0, 16);
    const twice = smoothCamera(
      first,
      { x: truth.x + first.offset.x, y: 0, z: 0 },
      truth,
      0,
      16,
    ).offset.x;
    expect(twice).toBeCloseTo(once, 9);
  });

  it('takes a large correction at once instead of gliding to it', () => {
    // Gliding smoothly across two metres would leave the player shooting from
    // somewhere they are not for the whole of the glide.
    const far = { x: SNAP_DISTANCE_METRES + 0.5, y: 0, z: 0 };
    const snapped = smoothCamera(NO_SMOOTHING, far, { x: 0, y: 0, z: 0 }, 0, 16);
    expect(snapped.offset).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('drops the offset outright when the player respawns', () => {
    // The distance between where you died and where you reappear is not an
    // error to ease away; easing it would slide the camera out of the spawn.
    const previous = { offset: { x: 0.3, y: 0, z: 0 }, epoch: 2 };
    const respawned = smoothCamera(previous, { x: 9, y: 0, z: 9 }, { x: 0, y: 0, z: 0 }, 3, 16);
    expect(respawned.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(respawned.epoch).toBe(3);
  });
});

describe('the readout', () => {
  it('counts the countdown down in whole seconds', () => {
    const opening = hudFor(frame({ phase: 'countdown', phaseTicks: 3 * TICK_RATE }));
    expect(opening.message).toBe('3');
    expect(hudFor(frame({ phase: 'countdown', phaseTicks: 1 })).message).toBe('1');
    expect(hudFor(frame({ phase: 'countdown', phaseTicks: 0 })).crosshair).toBe(false);
  });

  it('shows the respawn timer in seconds while dead, and no crosshair', () => {
    const dead = hudFor(
      frame({ self: player({ alive: false, respawnTicks: RESPAWN_TICKS }) }),
    );
    expect(dead.respawnSeconds).toBeCloseTo(RESPAWN_TICKS / TICK_RATE, 9);
    expect(dead.crosshair).toBe(false);
  });

  it('puts a crosshair up only while the round is live and the player is not', () => {
    expect(hudFor(frame({ phase: 'playing' })).crosshair).toBe(true);
    expect(hudFor(frame({ phase: 'waiting' })).crosshair).toBe(false);
    expect(hudFor(frame({ phase: 'finished' })).crosshair).toBe(false);
  });

  it('tells each seat whether the result was theirs', () => {
    expect(hudFor(frame({ phase: 'finished', seat: 'north', winner: 'north' })).message).toBe(
      'You win',
    );
    expect(hudFor(frame({ phase: 'finished', seat: 'north', winner: 'south' })).message).toBe(
      'You lose',
    );
  });

  it('reads the score from this seat outwards', () => {
    const readout = hudFor(
      frame({
        self: player({ score: 4 }),
        opponent: player({ seat: 'south', score: 6 }),
      }),
    );
    expect(readout.ownScore).toBe(4);
    expect(readout.opponentScore).toBe(6);
  });
});

describe('the eye', () => {
  it('sits above the feet, and lower when crouched', () => {
    const standing = eyeOf(restingBody(SPAWNS.north));
    const crouched = eyeOf({ ...restingBody(SPAWNS.north), crouching: true, crouchAmount: 1 });
    expect(standing.y).toBeGreaterThan(crouched.y);
    expect(standing.x).toBe(SPAWNS.north.x);
  });
});

const ZERO = { x: 0, y: 0, z: 0 };
const FORWARD = { x: 0, y: 0, z: 1 };

function bodyAt(x: number): PlayerBody {
  return { ...restingBody(SPAWNS.north), x };
}

function shot(over: Partial<TimedShot> = {}): TimedShot {
  return {
    id: 1,
    origin: { x: 0, y: 1.6, z: 11.5 },
    endpoint: { x: 0, y: 0.9, z: -11.5 },
    hitPlayer: false,
    seenAt: 1000,
    mine: false,
    ...over,
  };
}

describe('fading feedback', () => {
  it('is full at the moment it happened and nothing at the end', () => {
    expect(fadeSince(1000, 1000, 1)).toBe(1);
    expect(fadeSince(1500, 1000, 1)).toBeCloseTo(0.5, 9);
    expect(fadeSince(2000, 1000, 1)).toBe(0);
    expect(fadeSince(9000, 1000, 1)).toBe(0);
  });

  it('is nothing at all when it never happened', () => {
    // The first frame of a match has no last death and no last hit. Both have
    // to fade to nothing rather than flash on arrival.
    expect(fadeSince(1000, null, 1)).toBe(0);
  });

  it('is nothing for a moment that has not arrived yet', () => {
    expect(fadeSince(500, 1000, 1)).toBe(0);
  });
});

describe('tracers', () => {
  it('are drawn from the moment they were first seen', () => {
    const drawn = drawableShots([shot({ seenAt: 1000 })], 1000);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.fade).toBe(0);
    expect(drawn[0]?.from).toEqual(shot().origin);
    expect(drawn[0]?.to).toEqual(shot().endpoint);
  });

  it('fade out over their lifetime and then are gone', () => {
    const halfway = drawableShots([shot()], 1000 + TRACER_SECONDS * 500);
    expect(halfway[0]?.fade).toBeCloseTo(0.5, 6);
    expect(drawableShots([shot()], 1000 + TRACER_SECONDS * 1000)).toHaveLength(0);
    expect(drawableShots([shot()], 9000)).toHaveLength(0);
  });

  it('leave the muzzle when the shot is your own and goes somewhere', () => {
    const muzzle = { x: 0.3, y: 1.4, z: 10.9 };
    const [theirs] = drawableShots([shot()], 1000, muzzle);
    const [mine] = drawableShots([shot({ mine: true })], 1000, muzzle);
    // Somebody else's tracer starts where the server says it did — their muzzle
    // is not something this client knows or needs to.
    expect(theirs?.from).toEqual(shot().origin);
    expect(mine?.from).toEqual(muzzle);
  });

  it('leave the eye for a shot that stops at the end of the barrel', () => {
    // Firing at the floor by your own feet: the bullet stops about where the
    // muzzle already is, and a tracer from the muzzle to a point beside it has
    // no length and never appears.
    const muzzle = { x: 0, y: 0.3, z: 11.5 };
    const [drawn] = drawableShots(
      [shot({ mine: true, endpoint: { x: 0, y: 0, z: 11.5 } })],
      1000,
      muzzle,
    );
    expect(drawn?.from).toEqual(shot().origin);
  });

  it('keep the shooter apart from what they hit', () => {
    const [missed, landed] = drawableShots(
      [shot({ id: 1, hitPlayer: false }), shot({ id: 2, hitPlayer: true })],
      1000,
    );
    expect(missed?.hitPlayer).toBe(false);
    expect(landed?.hitPlayer).toBe(true);
    expect(landed?.id).toBe(2);
  });
});

describe('hit and damage', () => {
  it('mark a shot that connected, briefly', () => {
    const marked = hudFor(frame(), 1000, 1000, null);
    expect(marked.hitMarker).toBe(1);
    expect(marked.damage).toBe(0);
    expect(hudFor(frame(), 1000 + HIT_MARKER_SECONDS * 1000, 1000, null).hitMarker).toBe(0);
  });

  it('mark being hit, for longer than marking a hit', () => {
    // Being killed is worth more of the screen for longer than killing is: one
    // of them needs explaining and the other does not.
    expect(DAMAGE_SECONDS).toBeGreaterThan(HIT_MARKER_SECONDS);
    const hurt = hudFor(frame(), 1000, null, 1000);
    expect(hurt.damage).toBe(1);
    expect(hurt.hitMarker).toBe(0);
  });

  it('show neither before anything has happened', () => {
    const opening = hudFor(frame());
    expect(opening.hitMarker).toBe(0);
    expect(opening.damage).toBe(0);
  });
});
