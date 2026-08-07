package arena

import "math"

// Where a body's parts are, given where the body is and which way it faces.
//
// A port of packages/games/arena/logic/src/pose.ts, and it has to be an exact
// one: these boxes are what a shot is tested against, so a limb laid out a
// millimetre differently here is a limb the client draws in one place and the
// server judges in another.
//
// It is free of trigonometry for the same reason the rest of the package is.
// The legs are where that usually breaks down — a knee is a joint and a joint
// is a rotation — so it is solved as a distance instead: the feet are placed
// first and the knee is found where the two circles cross, one around the hip
// at thigh length and one around the foot at shin length. That is + - * / and
// one square root, all of which IEEE-754 rounds exactly in both languages.

// Body parts. The values match the TypeScript ones exactly, because both appear
// in the conformance vectors.
const (
	PartHead      = "head"
	PartTorso     = "torso"
	PartArmLeft   = "armLeft"
	PartArmRight  = "armRight"
	PartThighLeft = "thighLeft"
	PartThighRight = "thighRight"
	PartShinLeft  = "shinLeft"
	PartShinRight = "shinRight"
	PartWeapon    = "weapon"
	PartSight     = "sight"
)

// PartBox is a box with an orientation of its own. Half is measured along
// Right, Up and Forward in that order.
type PartBox struct {
	Part    string
	Centre  Vec3
	Half    Vec3
	Right   Vec3
	Up      Vec3
	Forward Vec3
}

// Pose is a whole body laid out, plus where a shot leaves its rifle.
type Pose struct {
	Forward Vec3
	Right   Vec3
	Parts   []PartBox
	Muzzle  Vec3
}

var (
	defaultFacing = Vec3{X: 0, Y: 0, Z: 1}
	poseUp        = Vec3{X: 0, Y: 1, Z: 0}
	poseDown      = Vec3{X: 0, Y: -1, Z: 0}
)

// The figure, in metres. Typed float64 constants for the same reason every
// other constant in this package is one.
const (
	headHalf       float64 = 0.14
	torsoHalfWidth float64 = 0.24
	torsoHalfDepth float64 = 0.14
	torsoLength    float64 = 0.64
	hipHalfWidth   float64 = 0.11
	// A shade longer together than the hips ride high, so a standing leg
	// carries the soft bend a real one does rather than locking dead straight.
	thighLength float64 = 0.42
	shinLength  float64 = 0.39
	legHalf     float64 = 0.085
	armHalf     float64 = 0.075
	// ankle is how high the sole of a foot is, so a leg stands on the ground
	// rather than in it.
	ankle float64 = 0.085

	hipStanding float64 = 0.88
	hipCrouched float64 = 0.34
	// hipSetback is how far the hips travel backwards into a full crouch. The
	// knees go forward and the seat goes back, and the two cancel: the head
	// ends up over the feet rather than out in front of them.
	hipSetback float64 = 0.28

	stepReach float64 = 0.34
	footLift  float64 = 0.14
	// torsoLean is how far the torso tips forward when fully crouched. The
	// chest has to come over the knees or the figure falls backwards, and it is
	// also what brings the head down inside the shorter hitbox.
	torsoLean float64 = 0.85

	weaponHalfLength float64 = 0.4
)

func addScaled(a, b Vec3, scale float64) Vec3 {
	return Vec3{
		X: a.X + float64(b.X*scale),
		Y: a.Y + float64(b.Y*scale),
		Z: a.Z + float64(b.Z*scale),
	}
}

func crossOf(a, b Vec3) Vec3 {
	return Vec3{
		X: float64(a.Y*b.Z) - float64(a.Z*b.Y),
		Y: float64(a.Z*b.X) - float64(a.X*b.Z),
		Z: float64(a.X*b.Y) - float64(a.Y*b.X),
	}
}

func normaliseOr(v, fallback Vec3) Vec3 {
	lengthSquared := float64(v.X*v.X) + float64(v.Y*v.Y) + float64(v.Z*v.Z)
	if lengthSquared <= 0 {
		return fallback
	}
	length := math.Sqrt(lengthSquared)
	return Vec3{X: v.X / length, Y: v.Y / length, Z: v.Z / length}
}

func distanceOf(a, b Vec3) float64 {
	dx := b.X - a.X
	dy := b.Y - a.Y
	dz := b.Z - a.Z
	return math.Sqrt(float64(dx*dx) + float64(dy*dy) + float64(dz*dz))
}

// frameFrom builds a complete frame from one axis and a hint about which way is
// forward. Cross products and one normalisation: no angle is ever named.
func frameFrom(up, hint Vec3) (right, upOut, forward Vec3) {
	right = normaliseOr(crossOf(up, hint), Vec3{X: 1, Y: 0, Z: 0})
	return right, up, crossOf(right, up)
}

// FacingOf is the horizontal direction a body faces, from where it is looking.
//
// Flattened and renormalised rather than taken whole: a player looking at their
// feet is still standing upright.
func FacingOf(aim Vec3) Vec3 {
	lengthSquared := float64(aim.X*aim.X) + float64(aim.Z*aim.Z)
	if lengthSquared <= 0 {
		return defaultFacing
	}
	magnitude := math.Sqrt(lengthSquared)
	return Vec3{X: aim.X / magnitude, Y: 0, Z: aim.Z / magnitude}
}

// Swing is the stride, from minus one to one and back, linearly.
func Swing(phase float64) float64 {
	if phase < 0.5 {
		return float64(phase*4) - 1
	}
	return 3 - float64(phase*4)
}

// Lift is how far a foot is off the ground, over the half of the cycle it is
// swinging. Zero for the whole of the other half, which is what makes it a walk
// rather than a hover: one foot is always planted.
func Lift(phase float64) float64 {
	if phase >= 0.5 {
		return 0
	}
	if phase < 0.25 {
		return float64(phase * 4)
	}
	return 2 - float64(phase*4)
}

// kneeOf finds the knee, given a hip, a foot and two bones.
//
// The two-circle construction: every point at thigh length from the hip lies on
// one sphere, every point at shin length from the foot lies on another, and the
// knee is on the circle where they meet. along is how far down the hip-to-foot
// line that circle sits and out is its radius, and the knee is picked off it in
// the direction the leg bends — forwards, because that is which way a knee goes.
//
// A foot placed further away than the leg is long is pulled in first, so the
// square root never sees a negative number and the leg never comes apart.
func kneeOf(hip, foot, bend Vec3) (knee, placed Vec3) {
	reach := distanceOf(hip, foot)
	span := thighLength + shinLength

	clamped := reach
	switch {
	case reach > span-0.004:
		clamped = span - 0.004
	case reach < 0.12:
		clamped = 0.12
	}

	axis := normaliseOr(Vec3{X: foot.X - hip.X, Y: foot.Y - hip.Y, Z: foot.Z - hip.Z}, poseDown)

	along := (float64(clamped*clamped) + float64(thighLength*thighLength) - float64(shinLength*shinLength)) /
		float64(2*clamped)
	outSquared := float64(thighLength*thighLength) - float64(along*along)
	out := 0.0
	if outSquared > 0 {
		out = math.Sqrt(outSquared)
	}

	// Perpendicular to the leg, in the plane the leg bends in.
	side := crossOf(axis, bend)
	outward := normaliseOr(crossOf(side, axis), bend)

	return addScaled(addScaled(hip, axis, along), outward, out), addScaled(hip, axis, clamped)
}

// PoseOf lays out one body's parts.
func PoseOf(body PlayerBody, aim Vec3) Pose {
	forward := FacingOf(aim)
	// A quarter turn to the right, which for a horizontal unit vector is a swap
	// and one sign.
	right := Vec3{X: forward.Z, Y: 0, Z: -forward.X}
	aimUnit := normaliseOr(aim, forward)

	crouch := body.CrouchAmount
	uprightRight, uprightUp, uprightForward := frameFrom(poseUp, forward)

	at := func(rightward, up, forwardward float64) Vec3 {
		return Vec3{
			X: body.X + float64(right.X*rightward) + float64(forward.X*forwardward),
			Y: body.Y + up,
			Z: body.Z + float64(right.Z*rightward) + float64(forward.Z*forwardward),
		}
	}

	// segment is a box reaching from one point to another, as thick as it is
	// told.
	segment := func(part string, from, to Vec3, half float64) PartBox {
		length := distanceOf(from, to)
		axis := normaliseOr(Vec3{X: to.X - from.X, Y: to.Y - from.Y, Z: to.Z - from.Z}, poseDown)
		frameRight, frameUp, frameForward := frameFrom(Vec3{X: -axis.X, Y: -axis.Y, Z: -axis.Z}, forward)
		return PartBox{
			Part:    part,
			Centre:  addScaled(from, axis, length/2),
			Half:    Vec3{X: half, Y: length / 2, Z: half},
			Right:   frameRight,
			Up:      frameUp,
			Forward: frameForward,
		}
	}

	// Legs, from the feet up.
	hipHeight := hipStanding + float64((hipCrouched-hipStanding)*crouch)
	stride := Swing(body.GaitPhase)
	reach := float64(stepReach * body.GaitPower)
	rise := float64(footLift * body.GaitPower)

	otherPhase := body.GaitPhase + 0.5
	if body.GaitPhase >= 0.5 {
		otherPhase = body.GaitPhase - 0.5
	}
	footRight := at(hipHalfWidth, ankle+float64(rise*Lift(body.GaitPhase)), float64(stride*reach))
	footLeft := at(-hipHalfWidth, ankle+float64(rise*Lift(otherPhase)), float64(-stride*reach))
	// The feet stay under the body; only the hips travel back.
	hipBack := -float64(hipSetback * crouch)
	hipRight := at(hipHalfWidth, hipHeight, hipBack)
	hipLeft := at(-hipHalfWidth, hipHeight, hipBack)

	kneeRight, placedRight := kneeOf(hipRight, footRight, forward)
	kneeLeft, placedLeft := kneeOf(hipLeft, footLeft, forward)

	// Torso, head and shoulders.
	torsoUp := normaliseOr(Vec3{
		X: float64(forward.X * torsoLean * crouch),
		Y: 1,
		Z: float64(forward.Z * torsoLean * crouch),
	}, poseUp)
	torsoRight, torsoUpOut, torsoForward := frameFrom(torsoUp, forward)
	hips := at(0, hipHeight, hipBack)
	neck := addScaled(hips, torsoUp, torsoLength)
	// The head stays level while the torso tips: a player crouched behind cover
	// is still looking over it.
	headCentre := addScaled(neck, poseUp, float64(headHalf*0.85))

	shoulderRight := addScaled(addScaled(neck, torsoRight, float64(torsoHalfWidth*0.8)), torsoUp, -0.06)
	shoulderLeft := addScaled(addScaled(neck, torsoRight, -float64(torsoHalfWidth*0.8)), torsoUp, -0.06)

	// The rifle, along the aim rather than along the facing, and the hands on it.
	weaponCentre := addScaled(addScaled(addScaled(shoulderRight, aimUnit, 0.36), right, -0.04), poseUp, -0.06)
	muzzle := addScaled(weaponCentre, aimUnit, weaponHalfLength)
	weaponRight, weaponUp, weaponForward := frameFrom(
		normaliseOr(crossOf(crossOf(aimUnit, poseUp), aimUnit), poseUp),
		aimUnit,
	)

	gripHand := addScaled(weaponCentre, aimUnit, -0.14)
	foreHand := addScaled(weaponCentre, aimUnit, 0.2)

	return Pose{
		Forward: forward,
		Right:   right,
		Muzzle:  muzzle,
		Parts: []PartBox{
			{
				Part:    PartHead,
				Centre:  headCentre,
				Half:    Vec3{X: headHalf, Y: headHalf, Z: headHalf},
				Right:   uprightRight,
				Up:      uprightUp,
				Forward: uprightForward,
			},
			{
				Part:    PartTorso,
				Centre:  addScaled(hips, torsoUp, torsoLength/2),
				Half:    Vec3{X: torsoHalfWidth, Y: torsoLength / 2, Z: torsoHalfDepth},
				Right:   torsoRight,
				Up:      torsoUpOut,
				Forward: torsoForward,
			},
			segment(PartArmRight, shoulderRight, gripHand, armHalf),
			segment(PartArmLeft, shoulderLeft, foreHand, armHalf),
			segment(PartThighRight, hipRight, kneeRight, legHalf),
			segment(PartThighLeft, hipLeft, kneeLeft, legHalf),
			segment(PartShinRight, kneeRight, placedRight, legHalf),
			segment(PartShinLeft, kneeLeft, placedLeft, legHalf),
			{
				Part:    PartWeapon,
				Centre:  weaponCentre,
				Half:    Vec3{X: 0.04, Y: 0.05, Z: weaponHalfLength},
				Right:   weaponRight,
				Up:      weaponUp,
				Forward: weaponForward,
			},
			{
				Part:    PartSight,
				Centre:  addScaled(addScaled(weaponCentre, weaponUp, 0.08), aimUnit, -0.06),
				Half:    Vec3{X: 0.028, Y: 0.032, Z: 0.1},
				Right:   weaponRight,
				Up:      weaponUp,
				Forward: weaponForward,
			},
		},
	}
}

// HittablePartsOf is the parts a shot can hit: a body, never its rifle.
func HittablePartsOf(pose Pose) []PartBox {
	parts := make([]PartBox, 0, len(pose.Parts))
	for _, part := range pose.Parts {
		if part.Part == PartWeapon || part.Part == PartSight {
			continue
		}
		parts = append(parts, part)
	}
	return parts
}
