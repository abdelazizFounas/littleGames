package arena

// Where a shot goes, and what it finds.
//
// This is in the shared rules rather than on the server alone, and that was a
// deliberate change of mind. Hit registration is the most disputed mechanic in
// any shooter; leaving it as the one rule the conformance vectors did not pin
// would have been leaving out the part most worth pinning.

// RayVsBox reports how far along the ray it enters the box, and whether it ever
// does.
//
// The classic form of this multiplies by 1/direction and lets the infinities
// sort themselves out. That form produces 0 × ∞ = NaN for a ray running
// parallel to a face and starting on its plane, and Go and TypeScript do not
// agree about how a NaN travels through the comparisons that follow. So a
// degenerate axis is branched on and never divided through.
//
// A ray starting inside the box enters it at zero.
func RayVsBox(origin, direction Vec3, box Bounds, maxDistance float64) (float64, bool) {
	enter := 0.0
	exit := maxDistance

	// slab narrows the interval the ray is inside the box on one axis, and
	// reports whether anything is left of it.
	slab := func(originAxis, directionAxis, minAxis, maxAxis float64) bool {
		if directionAxis == 0 {
			return originAxis >= minAxis && originAxis <= maxAxis
		}
		a := (minAxis - originAxis) / directionAxis
		b := (maxAxis - originAxis) / directionAxis
		near, far := a, b
		if b < a {
			near, far = b, a
		}
		if near > enter {
			enter = near
		}
		if far < exit {
			exit = far
		}
		return enter <= exit
	}

	if !slab(origin.X, direction.X, box.MinX, box.MaxX) {
		return 0, false
	}
	if !slab(origin.Y, direction.Y, box.MinY, box.MaxY) {
		return 0, false
	}
	if !slab(origin.Z, direction.Z, box.MinZ, box.MaxZ) {
		return 0, false
	}

	return enter, true
}

// RayVsOrientedBox reports how far along the ray it enters a box with an
// orientation of its own.
//
// The same slab test, done in the box's frame instead of the world's. A part of
// a body carries its own right, up and forward, so the ray's origin and
// direction are projected onto those three axes with dot products and the
// result is an axis-aligned problem again. No matrix, no inverse, and nothing
// that is not a multiply and an add.
func RayVsOrientedBox(origin, direction Vec3, box OrientedBox, maxDistance float64) (float64, bool) {
	dx := origin.X - box.Centre.X
	dy := origin.Y - box.Centre.Y
	dz := origin.Z - box.Centre.Z
	along := func(axis Vec3) float64 {
		return float64(dx*axis.X) + float64(dy*axis.Y) + float64(dz*axis.Z)
	}
	cast := func(axis Vec3) float64 {
		return float64(direction.X*axis.X) + float64(direction.Y*axis.Y) + float64(direction.Z*axis.Z)
	}

	return RayVsBox(
		Vec3{X: along(box.Right), Y: along(box.Up), Z: along(box.Forward)},
		Vec3{X: cast(box.Right), Y: cast(box.Up), Z: cast(box.Forward)},
		Bounds{
			MinX: -box.Half.X, MinY: -box.Half.Y, MinZ: -box.Half.Z,
			MaxX: box.Half.X, MaxY: box.Half.Y, MaxZ: box.Half.Z,
		},
		maxDistance,
	)
}

// OrientedBox is a box that is not aligned to the world: a limb, a torso, a
// rifle.
type OrientedBox struct {
	Centre  Vec3
	Half    Vec3
	Right   Vec3
	Up      Vec3
	Forward Vec3
}

// ShotTarget is one part of one body, where it stood at the judged moment.
type ShotTarget struct {
	Seat string
	Part string
	Box  OrientedBox
}

// Trace is what one shot found.
type Trace struct {
	// HitSeat is who was hit, or empty for nobody.
	HitSeat string
	// HitPart is which part of them, which is what decides the damage.
	HitPart string
	// Endpoint is where the shot stopped: a body, a wall, or the end of its
	// range.
	Endpoint Vec3
	Distance float64
}

// TraceShot fires one shot and reports what it found.
//
// Walls are tested before bodies and win ties, so a target standing exactly
// against the far side of a crate is behind it rather than in front of it.
// Targets are given as boxes rather than as bodies because the server hands
// over where they were when the shooter saw them, not where they are now.
//
// Every part is tested and the nearest wins, which is what makes a head shot a
// head shot rather than whichever limb happened to be listed first — and why
// the parts must be the same ones the renderer draws.
func TraceShot(origin, aim Vec3, targets []ShotTarget) Trace {
	closest := MaxShotDistance

	for _, occluder := range Occluders {
		distance, hit := RayVsBox(origin, aim, boundsOf(occluder), closest)
		if hit && distance < closest {
			closest = distance
		}
	}

	hitSeat, hitPart := "", ""
	for _, target := range targets {
		distance, hit := RayVsOrientedBox(origin, aim, target.Box, closest)
		if hit && distance < closest {
			closest = distance
			hitSeat = target.Seat
			hitPart = target.Part
		}
	}

	return Trace{
		HitSeat: hitSeat,
		HitPart: hitPart,
		Endpoint: Vec3{
			X: origin.X + float64(aim.X*closest),
			Y: origin.Y + float64(aim.Y*closest),
			Z: origin.Z + float64(aim.Z*closest),
		},
		Distance: closest,
	}
}

func boundsOf(box Box) Bounds {
	return Bounds{
		MinX: box.MinX, MinY: box.MinY, MinZ: box.MinZ,
		MaxX: box.MaxX, MaxY: box.MaxY, MaxZ: box.MaxZ,
	}
}
