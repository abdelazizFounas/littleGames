import { CROUCH_HEIGHT, STAND_HEIGHT } from './constants.ts';
import { FEET_TOGETHER_EARLY, type PlayerBody } from './body.ts';
import type { Vec3 } from './vector.ts';

/**
 * Where a body's parts are, given where the body is and which way it faces.
 *
 * One pose, read twice: the renderer draws these boxes and the shot test aims
 * at them. Anything else would be a game where the legs you can see are not the
 * legs you can hit, which is the oldest complaint in the genre.
 *
 * It is pure, and it is free of trigonometry. The facing comes from the aim
 * vector the rules already carry — normalised in the horizontal plane — and the
 * sideways direction is that vector turned a quarter turn, which is a swap and
 * a sign rather than a sine. The stride is a triangle wave for the same reason:
 * piecewise linear is exact in both languages, and a linear swing is what a
 * flat-shaded voxel limb should do anyway.
 */

export type BodyPart =
  | 'head'
  | 'torso'
  | 'armLeft'
  | 'armRight'
  | 'legLeft'
  | 'legRight'
  | 'weapon'
  | 'sight';

/** A box in the body's own frame: along its right, its up, and its facing. */
export interface PartBox {
  readonly part: BodyPart;
  /** Centre, in world metres. */
  readonly centre: Vec3;
  /** Half the size along the body's right, up and forward axes. */
  readonly half: Vec3;
}

/** A posed body: the boxes, and the frame they are expressed in. */
export interface Pose {
  /** Unit, horizontal, pointing where the body faces. */
  readonly forward: Vec3;
  /** Unit, horizontal, ninety degrees to the right of `forward`. */
  readonly right: Vec3;
  readonly parts: readonly PartBox[];
}

/** Facing when the aim is straight up or down and says nothing about facing. */
const DEFAULT_FACING: Vec3 = { x: 0, y: 0, z: 1 };

/**
 * The horizontal direction a body faces, from where it is looking.
 *
 * Flattened and renormalised rather than taken whole: a player looking at their
 * feet is still standing upright, and a body that leaned with the aim would put
 * its head through the floor.
 */
export function facingOf(aim: Vec3): Vec3 {
  const lengthSquared = aim.x * aim.x + aim.z * aim.z;
  if (lengthSquared <= 0) {
    return DEFAULT_FACING;
  }
  const length = Math.sqrt(lengthSquared);
  return { x: aim.x / length, y: 0, z: aim.z / length };
}

/**
 * The stride, from minus one to one and back, linearly.
 *
 * A triangle rather than a sine, because sine is not exactly rounded and these
 * numbers have to agree between two languages to the last bit.
 */
export function swing(phase: number): number {
  return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
}

/* Proportions, as fractions of standing height unless stated in metres. */
const HEAD_HALF = 0.16;
const TORSO_HALF_WIDTH = 0.3;
const TORSO_HALF_DEPTH = 0.16;
const LIMB_HALF = 0.09;
/** How far a leg swings fore and aft at full stride, in metres. */
const LEG_REACH = 0.28;
/** Arms swing against the legs, and less. */
const ARM_REACH = 0.2;

/**
 * Poses a body.
 *
 * Everything is measured from the feet, which is what the rules hold, and the
 * whole figure shortens when crouched rather than sinking through the floor.
 */
export function poseOf(body: PlayerBody, aim: Vec3): Pose {
  const forward = facingOf(aim);
  // A quarter turn to the right of the facing, which for a horizontal unit
  // vector is a swap and one sign — no angle anywhere.
  const right: Vec3 = { x: forward.z, y: 0, z: -forward.x };

  const height = body.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  const scale = height / STAND_HEIGHT;

  const legHeight = 0.78 * scale;
  const torsoHeight = 0.62 * scale;
  const headCentre = height - HEAD_HALF;
  const torsoCentre = legHeight + torsoHeight / 2;

  // Legs opposed, arms opposed to the legs. A player who has come to a stop has
  // settled on a phase where the swing is zero, so they simply stand.
  const stride = swing(body.gaitPhase);
  const legOffset = stride * LEG_REACH * scale;
  const armOffset = -stride * ARM_REACH * scale;

  const at = (rightward: number, up: number, forwardward: number): Vec3 => ({
    x: body.x + right.x * rightward + forward.x * forwardward,
    y: body.y + up,
    z: body.z + right.z * rightward + forward.z * forwardward,
  });

  const parts: PartBox[] = [
    {
      part: 'head',
      centre: at(0, headCentre, 0.02),
      half: { x: HEAD_HALF, y: HEAD_HALF, z: HEAD_HALF },
    },
    {
      part: 'torso',
      centre: at(0, torsoCentre, 0),
      half: { x: TORSO_HALF_WIDTH, y: torsoHeight / 2, z: TORSO_HALF_DEPTH },
    },
    {
      part: 'armLeft',
      centre: at(-(TORSO_HALF_WIDTH + LIMB_HALF), torsoCentre + 0.04 * scale, armOffset),
      half: { x: LIMB_HALF, y: torsoHeight / 2, z: LIMB_HALF },
    },
    {
      part: 'armRight',
      centre: at(TORSO_HALF_WIDTH + LIMB_HALF, torsoCentre + 0.04 * scale, -armOffset),
      half: { x: LIMB_HALF, y: torsoHeight / 2, z: LIMB_HALF },
    },
    {
      part: 'legLeft',
      centre: at(-0.14, legHeight / 2, legOffset),
      half: { x: LIMB_HALF + 0.02, y: legHeight / 2, z: LIMB_HALF + 0.02 },
    },
    {
      part: 'legRight',
      centre: at(0.14, legHeight / 2, -legOffset),
      half: { x: LIMB_HALF + 0.02, y: legHeight / 2, z: LIMB_HALF + 0.02 },
    },
  ];

  return { forward, right, parts };
}

/** Where the rifle sits, given a pose. Drawn, never shot at. */
export function weaponOf(body: PlayerBody, pose: Pose): readonly PartBox[] {
  const height = body.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  const scale = height / STAND_HEIGHT;
  const { forward, right } = pose;
  // Held at the shoulder of the right arm, level, pointing where the body does.
  const shoulder = 1.28 * scale;

  const at = (rightward: number, up: number, forwardward: number): Vec3 => ({
    x: body.x + right.x * rightward + forward.x * forwardward,
    y: body.y + up,
    z: body.z + right.z * rightward + forward.z * forwardward,
  });

  return [
    { part: 'weapon', centre: at(0.24, shoulder, 0.42), half: { x: 0.05, y: 0.05, z: 0.55 } },
    { part: 'sight', centre: at(0.24, shoulder + 0.1, 0.24), half: { x: 0.035, y: 0.05, z: 0.14 } },
  ];
}

export { FEET_TOGETHER_EARLY };
