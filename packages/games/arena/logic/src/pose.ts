import { CROUCH_HEIGHT, STAND_HEIGHT } from './constants.ts';
import type { PlayerBody } from './body.ts';
import type { Vec3 } from './vector.ts';

/**
 * Where a body's parts are, given where the body is and which way it faces.
 *
 * One pose, read twice: the renderer draws these boxes and the shot test aims
 * at them. Anything else would be a game where the limbs you can see are not
 * the limbs you can hit, which is the oldest complaint in the genre.
 *
 * It is pure, and it is free of trigonometry — which matters, because a second
 * implementation in Go has to land on the same bits. The legs are the place
 * that usually forces an angle: a knee is a joint, and a joint is a rotation.
 * Here it is solved as a distance instead. The feet are placed first, and the
 * knee is found where the two circles — one around the hip at thigh length, one
 * around the foot at shin length — cross. That is `+ - * /` and one square
 * root, all of which IEEE-754 rounds exactly in both languages. A sine is not.
 */

export type BodyPart =
  | 'head'
  | 'torso'
  | 'armLeft'
  | 'armRight'
  | 'thighLeft'
  | 'thighRight'
  | 'shinLeft'
  | 'shinRight'
  | 'weapon'
  | 'sight';

/**
 * A box with an orientation of its own.
 *
 * Axis-aligned boxes were enough while a body was one block. A thigh that
 * hinges at the hip is not axis-aligned to anything, so each part carries the
 * frame it is measured in: `half` is along `right`, `up` and `forward` in that
 * order.
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
const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

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

/**
 * How far a foot is off the ground, over the half of the cycle it is swinging.
 *
 * Zero for the whole of the other half, which is what makes it a walk rather
 * than a hover: one foot is always planted. Piecewise linear, like everything
 * else here.
 */
export function lift(phase: number): number {
  if (phase >= 0.5) {
    return 0;
  }
  return phase < 0.25 ? phase * 4 : 2 - phase * 4;
}

/* --- The figure, in metres ------------------------------------------------ */

const HEAD_HALF = 0.14;
const TORSO_HALF_WIDTH = 0.24;
const TORSO_HALF_DEPTH = 0.14;
const TORSO_LENGTH = 0.64;
/** How far apart the hips are, which is also how far apart the feet stand. */
const HIP_HALF_WIDTH = 0.11;
// A shade longer together than the hips ride high, so a standing leg carries
// the soft bend a real one does rather than locking dead straight.
const THIGH_LENGTH = 0.42;
const SHIN_LENGTH = 0.39;
const LEG_HALF = 0.085;
/** How high the sole of a foot is, so a leg stands on the ground not in it. */
const ANKLE = LEG_HALF;
const ARM_HALF = 0.075;

/** Where the hips ride, standing and fully crouched. */
const HIP_STANDING = 0.88;
const HIP_CROUCHED = 0.34;

/**
 * How far the hips travel backwards into a full crouch.
 *
 * Squatting is not folding in place. The knees go forward and the seat goes
 * back, and the two cancel: the head ends up over the feet rather than out in
 * front of them, which is what keeps a crouched figure inside the box it is
 * allowed to occupy.
 */
const HIP_SETBACK = 0.28;

/** How far a foot reaches fore and aft at the ends of a full stride. */
const STEP_REACH = 0.34;
/** How high the swinging foot comes off the ground at a full stride. */
const FOOT_LIFT = 0.14;

/**
 * How far the torso tips forward when fully crouched.
 *
 * A crouch is not a body lowered on a lift. Dropping the hips this far puts the
 * knees out in front, and the chest has to come over them or the figure falls
 * backwards — so the torso leans by roughly the same amount, which is also what
 * brings the head down inside the shorter hitbox.
 */
const TORSO_LEAN = 0.85;

/**
 * Where the knee goes, given a hip, a foot and two bones.
 *
 * The two-circle construction: every point at thigh length from the hip lies on
 * one sphere, every point at shin length from the foot lies on another, and the
 * knee is on the circle where they meet. `along` is how far down the hip-to-foot
 * line that circle sits and `out` is its radius, and the knee is picked off it
 * in the direction the leg bends — forwards, because that is which way a knee
 * goes.
 *
 * A foot placed further away than the leg is long is pulled in first, so the
 * square root never sees a negative number and the leg never comes apart.
 */
function kneeOf(
  hip: Vec3,
  foot: Vec3,
  bend: Vec3,
): { knee: Vec3; foot: Vec3 } {
  const reach = distance(hip, foot);
  const span = THIGH_LENGTH + SHIN_LENGTH;
  // Kept off both ends: fully straight leaves the knee with no side to bend to,
  // and a hip and foot in the same place has no direction between them at all.
  const clamped = reach > span - 0.004 ? span - 0.004 : reach < 0.12 ? 0.12 : reach;
  const axis = normalise(
    { x: foot.x - hip.x, y: foot.y - hip.y, z: foot.z - hip.z },
    DOWN,
  );

  const along =
    (clamped * clamped + THIGH_LENGTH * THIGH_LENGTH - SHIN_LENGTH * SHIN_LENGTH) /
    (2 * clamped);
  const outSquared = THIGH_LENGTH * THIGH_LENGTH - along * along;
  const out = outSquared > 0 ? Math.sqrt(outSquared) : 0;

  // Perpendicular to the leg, in the plane the leg bends in. Two cross products
  // rather than an angle, and it survives a leg pointing any which way.
  const side = cross(axis, bend);
  const outward = normalise(cross(side, axis), bend);

  return {
    knee: add(add(hip, axis, along), outward, out),
    foot: add(hip, axis, clamped),
  };
}

export function poseOf(body: PlayerBody, aim: Vec3): Pose {
  const forward = facingOf(aim);
  // A quarter turn to the right, which for a horizontal unit vector is a swap
  // and one sign — no angle anywhere.
  const right: Vec3 = { x: forward.z, y: 0, z: -forward.x };
  const aimUnit = normalise(aim, forward);

  const crouch = body.crouchAmount;
  const upright = frameFrom(UP, forward);

  const at = (rightward: number, up: number, forwardward: number): Vec3 => ({
    x: body.x + right.x * rightward + forward.x * forwardward,
    y: body.y + up,
    z: body.z + right.z * rightward + forward.z * forwardward,
  });

  /** A box reaching from one point to another, as thick as it is told. */
  const segment = (part: BodyPart, from: Vec3, to: Vec3, half: number): PartBox => {
    const length = distance(from, to);
    const axis = normalise(
      { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
      DOWN,
    );
    const frame = frameFrom({ x: -axis.x, y: -axis.y, z: -axis.z }, forward);
    return {
      part,
      centre: add(from, axis, length / 2),
      half: { x: half, y: length / 2, z: half },
      ...frame,
    };
  };

  /* --- Legs, from the feet up ------------------------------------------- */

  const hipHeight = HIP_STANDING + (HIP_CROUCHED - HIP_STANDING) * crouch;
  // The size of the step, not just where in the step the body is. Standing
  // still it is nothing, and the feet come together under straight legs.
  const stride = swing(body.gaitPhase);
  const reach = STEP_REACH * body.gaitPower;
  const rise = FOOT_LIFT * body.gaitPower;

  // The right foot leads while the left trails, and each rises over the half of
  // the cycle it is swinging through.
  const otherPhase = body.gaitPhase < 0.5 ? body.gaitPhase + 0.5 : body.gaitPhase - 0.5;
  const footRight = at(HIP_HALF_WIDTH, ANKLE + rise * lift(body.gaitPhase), stride * reach);
  const footLeft = at(-HIP_HALF_WIDTH, ANKLE + rise * lift(otherPhase), -stride * reach);
  // The feet stay under the body; only the hips travel back, which is what puts
  // the knees in front of the toes and the seat behind them.
  const hipBack = -HIP_SETBACK * crouch;
  const hipRight = at(HIP_HALF_WIDTH, hipHeight, hipBack);
  const hipLeft = at(-HIP_HALF_WIDTH, hipHeight, hipBack);

  const legRight = kneeOf(hipRight, footRight, forward);
  const legLeft = kneeOf(hipLeft, footLeft, forward);

  /* --- Torso, head and shoulders ---------------------------------------- */

  // Tipped forward as the body drops, so the chest comes over the knees rather
  // than the whole figure sinking like a lift.
  const torsoUp = normalise(
    { x: forward.x * TORSO_LEAN * crouch, y: 1, z: forward.z * TORSO_LEAN * crouch },
    UP,
  );
  const torsoFrame = frameFrom(torsoUp, forward);
  const hips = at(0, hipHeight, hipBack);
  const neck = add(hips, torsoUp, TORSO_LENGTH);
  // The head stays level while the torso tips: a player crouched behind cover is
  // still looking over it.
  const headCentre = add(neck, UP, HEAD_HALF * 0.85);

  const shoulderRight = add(add(neck, torsoFrame.right, TORSO_HALF_WIDTH * 0.8), torsoUp, -0.06);
  const shoulderLeft = add(add(neck, torsoFrame.right, -TORSO_HALF_WIDTH * 0.8), torsoUp, -0.06);

  /* --- The rifle, and the hands on it ----------------------------------- */

  // Along the aim rather than along the facing, so raising the barrel is what
  // raising the aim does, and shouldered rather than held out at the hip.
  const weaponHalfLength = 0.4;
  const weaponCentre = add(
    add(add(shoulderRight, aimUnit, 0.36), right, -0.04),
    UP,
    -0.06,
  );
  const muzzle = add(weaponCentre, aimUnit, weaponHalfLength);
  const weaponFrame = frameFrom(
    normalise(cross(cross(aimUnit, UP), aimUnit), UP),
    aimUnit,
  );

  const gripHand = add(weaponCentre, aimUnit, -0.14);
  const foreHand = add(weaponCentre, aimUnit, 0.2);

  return {
    forward,
    right,
    muzzle,
    parts: [
      {
        part: 'head',
        centre: headCentre,
        half: { x: HEAD_HALF, y: HEAD_HALF, z: HEAD_HALF },
        ...upright,
      },
      {
        part: 'torso',
        centre: add(hips, torsoUp, TORSO_LENGTH / 2),
        half: { x: TORSO_HALF_WIDTH, y: TORSO_LENGTH / 2, z: TORSO_HALF_DEPTH },
        ...torsoFrame,
      },
      segment('armRight', shoulderRight, gripHand, ARM_HALF),
      segment('armLeft', shoulderLeft, foreHand, ARM_HALF),
      segment('thighRight', hipRight, legRight.knee, LEG_HALF),
      segment('thighLeft', hipLeft, legLeft.knee, LEG_HALF),
      segment('shinRight', legRight.knee, legRight.foot, LEG_HALF),
      segment('shinLeft', legLeft.knee, legLeft.foot, LEG_HALF),
      {
        part: 'weapon',
        centre: weaponCentre,
        half: { x: 0.04, y: 0.05, z: weaponHalfLength },
        ...weaponFrame,
      },
      {
        part: 'sight',
        centre: add(add(weaponCentre, weaponFrame.up, 0.08), aimUnit, -0.06),
        half: { x: 0.028, y: 0.032, z: 0.1 },
        ...weaponFrame,
      },
    ],
  };
}

/** The parts a shot can hit: a body, never its rifle. */
export function hittablePartsOf(pose: Pose): readonly PartBox[] {
  return pose.parts.filter((part) => part.part !== 'weapon' && part.part !== 'sight');
}

/** How many boxes one body is drawn from, which is what the renderer reserves. */
export const PARTS_PER_BODY = 10;

export { CROUCH_HEIGHT, STAND_HEIGHT };
