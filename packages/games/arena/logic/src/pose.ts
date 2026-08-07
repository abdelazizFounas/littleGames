import { CROUCH_HEIGHT, STAND_HEIGHT } from './constants.ts';
import { FEET_TOGETHER_EARLY, bodyHeight, type PlayerBody } from './body.ts';
import type { Vec3 } from './vector.ts';

/**
 * Where a body's parts are, given where the body is and which way it faces.
 *
 * One pose, read twice: the renderer draws these boxes and the shot test aims
 * at them. Anything else would be a game where the limbs you can see are not
 * the limbs you can hit, which is the oldest complaint in the genre.
 *
 * It is pure, and it is free of trigonometry — which matters, because a second
 * implementation in Go has to land on the same bits. A limb that swings from
 * the hip is an angle in most engines; here it is a direction, built by adding
 * a fraction of the body's forward to straight down and normalising. A
 * normalisation is a square root, which IEEE-754 rounds exactly in both
 * languages. A sine is not.
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

/**
 * A box with an orientation of its own.
 *
 * Axis-aligned boxes were enough while a body was one block. A leg that hinges
 * at the hip is not axis-aligned to anything, so each part carries the frame it
 * is measured in: `half` is along `right`, `up` and `forward` in that order.
 */
export interface PartBox {
  readonly part: BodyPart;
  /** Centre, in world metres. */
  readonly centre: Vec3;
  /** Half the size along this part's own right, up and forward. */
  readonly half: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
}

export interface Pose {
  /** Unit, horizontal, pointing where the body faces. */
  readonly forward: Vec3;
  /** Unit, horizontal, ninety degrees to the right of `forward`. */
  readonly right: Vec3;
  readonly parts: readonly PartBox[];
  /** Where a shot leaves the rifle. */
  readonly muzzle: Vec3;
}

const DEFAULT_FACING: Vec3 = { x: 0, y: 0, z: 1 };
const UP: Vec3 = { x: 0, y: 1, z: 0 };

function add(a: Vec3, b: Vec3, scale: number): Vec3 {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalise(v: Vec3, fallback: Vec3): Vec3 {
  const lengthSquared = v.x * v.x + v.y * v.y + v.z * v.z;
  if (lengthSquared <= 0) {
    return fallback;
  }
  const length = Math.sqrt(lengthSquared);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function distance(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * A complete frame from one axis and a hint about which way is forward.
 *
 * Cross products and one normalisation: exact in both languages, and no angle
 * is ever named.
 */
function frameFrom(up: Vec3, hint: Vec3): { right: Vec3; up: Vec3; forward: Vec3 } {
  const right = normalise(cross(up, hint), { x: 1, y: 0, z: 0 });
  return { right, up, forward: cross(right, up) };
}

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
  const magnitude = Math.sqrt(lengthSquared);
  return { x: aim.x / magnitude, y: 0, z: aim.z / magnitude };
}

/** The stride, from minus one to one and back, linearly. */
export function swing(phase: number): number {
  return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
}

const HEAD_HALF = 0.15;
const TORSO_HALF_WIDTH = 0.28;
const TORSO_HALF_DEPTH = 0.15;
const LIMB_HALF = 0.085;
const LEG_HALF = 0.1;
/** How far forward a leg leans at full stride, as a fraction of straight down. */
const LEG_SWING = 0.55;
/** How far the knee comes forward when fully crouched. */
const CROUCH_LEAN = 0.75;
/** How much shorter the legs are when fully crouched. */
const CROUCH_SHORTENING = 0.42;

export function poseOf(body: PlayerBody, aim: Vec3): Pose {
  const forward = facingOf(aim);
  // A quarter turn to the right, which for a horizontal unit vector is a swap
  // and one sign — no angle anywhere.
  const right: Vec3 = { x: forward.z, y: 0, z: -forward.x };
  const aimUnit = normalise(aim, forward);

  const crouch = body.crouchAmount;
  const height = bodyHeight(body);

  // Hips at about half the height, which is where a person's are. They come
  // down further than the rest when crouching, because that is what bending
  // your knees does.
  const hipHeight = 0.5 * height * (1 - CROUCH_SHORTENING * crouch * 0.3);
  const legLength = hipHeight * (1 - CROUCH_SHORTENING * crouch);
  const torsoHeight = (height - hipHeight - HEAD_HALF * 2) * 0.92;
  const torsoCentre = hipHeight + torsoHeight / 2;
  const headCentre = height - HEAD_HALF;

  const at = (rightward: number, up: number, forwardward: number): Vec3 => ({
    x: body.x + right.x * rightward + forward.x * forwardward,
    y: body.y + up,
    z: body.z + right.z * rightward + forward.z * forwardward,
  });

  const upright = frameFrom(UP, forward);
  const stride = swing(body.gaitPhase);

  /** A limb hanging from a joint, leaning by a fraction of the body's forward. */
  const limb = (
    part: BodyPart,
    joint: Vec3,
    lean: number,
    limbLength: number,
    half: number,
  ): PartBox => {
    // Straight down, pushed forward. Normalising turns that into a direction
    // without ever naming the angle it makes.
    const axis = normalise(
      { x: forward.x * lean, y: -1, z: forward.z * lean },
      { x: 0, y: -1, z: 0 },
    );
    const frame = frameFrom({ x: -axis.x, y: -axis.y, z: -axis.z }, forward);
    return {
      part,
      centre: add(joint, axis, limbLength / 2),
      half: { x: half, y: limbLength / 2, z: half },
      ...frame,
    };
  };

  // The rifle, held out in front along the aim rather than along the facing, so
  // it points where the shot will actually go.
  const chest = at(0, torsoCentre + torsoHeight * 0.18, 0);
  const weaponCentre = add(add(chest, right, 0.12), aimUnit, 0.34);
  const weaponHalfLength = 0.42;
  const muzzle = add(weaponCentre, aimUnit, weaponHalfLength);
  const weaponFrame = frameFrom(
    normalise(cross(cross(aimUnit, UP), aimUnit), UP),
    aimUnit,
  );

  // Hands on the rifle, and the arms are simply what reaches them.
  const gripHand = add(weaponCentre, aimUnit, -0.12);
  const foreHand = add(weaponCentre, aimUnit, 0.24);
  const shoulderHeight = torsoCentre + torsoHeight * 0.3;
  const shoulderRight = at(TORSO_HALF_WIDTH * 0.85, shoulderHeight, 0);
  const shoulderLeft = at(-TORSO_HALF_WIDTH * 0.85, shoulderHeight, 0);

  /** An arm as a box reaching from a shoulder to a hand. */
  const arm = (part: BodyPart, shoulder: Vec3, hand: Vec3): PartBox => {
    const reach = distance(shoulder, hand);
    const axis = normalise(
      { x: hand.x - shoulder.x, y: hand.y - shoulder.y, z: hand.z - shoulder.z },
      { x: 0, y: -1, z: 0 },
    );
    const frame = frameFrom({ x: -axis.x, y: -axis.y, z: -axis.z }, forward);
    return {
      part,
      centre: add(shoulder, axis, reach / 2),
      half: { x: LIMB_HALF, y: reach / 2, z: LIMB_HALF },
      ...frame,
    };
  };

  const legLean = stride * LEG_SWING + crouch * CROUCH_LEAN;

  const parts: PartBox[] = [
    {
      part: 'head',
      centre: at(0, headCentre, 0.02),
      half: { x: HEAD_HALF, y: HEAD_HALF, z: HEAD_HALF },
      ...upright,
    },
    {
      part: 'torso',
      // Leaning forward as the body drops, which is what crouching looks like.
      centre: at(0, torsoCentre, crouch * 0.1),
      half: { x: TORSO_HALF_WIDTH, y: torsoHeight / 2, z: TORSO_HALF_DEPTH },
      ...upright,
    },
    arm('armRight', shoulderRight, gripHand),
    arm('armLeft', shoulderLeft, foreHand),
    limb('legRight', at(0.12, hipHeight, 0), legLean, legLength, LEG_HALF),
    limb('legLeft', at(-0.12, hipHeight, 0), -stride * LEG_SWING + crouch * CROUCH_LEAN, legLength, LEG_HALF),
    {
      part: 'weapon',
      centre: weaponCentre,
      half: { x: 0.045, y: 0.055, z: weaponHalfLength },
      ...weaponFrame,
    },
    {
      part: 'sight',
      centre: add(weaponCentre, weaponFrame.up, 0.09),
      half: { x: 0.03, y: 0.035, z: 0.11 },
      ...weaponFrame,
    },
  ];

  return { forward, right, parts, muzzle };
}

/** The parts a shot can hit: a body, never its rifle. */
export function hittablePartsOf(pose: Pose): readonly PartBox[] {
  return pose.parts.filter((part) => part.part !== 'weapon' && part.part !== 'sight');
}

export { FEET_TOGETHER_EARLY, CROUCH_HEIGHT, STAND_HEIGHT };
