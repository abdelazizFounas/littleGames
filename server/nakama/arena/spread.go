package arena

import "math"

// Where a shot goes, as opposed to where it was aimed.
//
// A rifle that always lands on the crosshair makes movement free: there is no
// reason ever to stop, to crouch, or to raise the sight. Spread is the price of
// all three, and it is charged from state both sides already hold — how big a
// step the shooter is taking, whether their feet are on the ground, how far
// they swung their aim in the last tick — so it needs no accumulator and
// tightens on its own the moment a player stands still.
//
// Two things make it safe to put in the rules. The randomness is integer, not
// floating point: a xorshift32 over a uint32, which is exactly the same
// sequence here and in JavaScript and cannot round differently. And the
// deflection is built with cross products rather than angles, so the whole file
// stays inside the arithmetic the conformance vectors can pin.

// Xorshift32 advances the generator by one step.
//
// The reference implementation writes this with Math.imul and >>> 0 because
// JavaScript has no other way to multiply and shift as 32-bit integers. Here it
// is simply what uint32 does, and the two agree exactly.
func Xorshift32(state uint32) uint32 {
	value := state
	// A zero state is a fixed point: it would return zero for ever, and every
	// shot seeded to it would land dead centre.
	if value == 0 {
		value = 0x9e3779b9
	}
	value ^= value << 13
	value ^= value >> 17
	value ^= value << 5
	return value
}

// SeedOf is a seed for one shot, from the two things that identify it: its own
// id and the seat that fired it, mixed with odd constants so that consecutive
// ids do not produce neighbouring seeds. Both sides know both numbers before
// the shot is resolved, which is the whole requirement.
func SeedOf(shotID, seatIndex int) uint32 {
	return uint32(shotID)*0x9e3779b1 + uint32(seatIndex+1)*0x85ebca6b
}

// UnitFrom is a number from minus one to just under one.
//
// Divided by a power of two, so it is exact in binary floating point and lands
// on the identical double in both languages — the same reason the wire
// quantises onto powers of two.
func UnitFrom(state uint32) float64 {
	return float64(state)/2147483648 - 1
}

// SpreadOf is how wide this shooter's shot may stray, in sideways metres per
// metre flown.
//
// Everything adds, and everything but the base can be got rid of: stop moving
// and the movement term goes with the size of the step, land and the airborne
// term goes, hold the aim still and the turning term goes. Raising the sight
// shrinks what is left of all of them to almost nothing, which is what makes it
// a trade rather than a button.
func SpreadOf(body PlayerBody, previousAim, aim Vec3, zoomed bool) float64 {
	dx := aim.X - previousAim.X
	dy := aim.Y - previousAim.Y
	dz := aim.Z - previousAim.Z
	turned := math.Sqrt(float64(dx*dx) + float64(dy*dy) + float64(dz*dz))

	airborne := 0.0
	if !body.Grounded {
		airborne = SpreadAirborne
	}

	total := SpreadBase +
		float64(SpreadMoving*body.GaitPower) +
		airborne +
		float64(SpreadTurning*turned)

	if zoomed {
		return float64(total * SpreadScopedShare)
	}
	return total
}

// Deflect is the aim, nudged off centre by this shot's own share of the spread.
//
// Two offsets in the plane across the aim rather than one, or every shot from a
// given position would stray along the same line. The plane is built from cross
// products against whichever world axis the aim is least parallel to — picked
// by comparison, so there is no angle and no degenerate case where the aim
// happens to point straight up.
func Deflect(aim Vec3, spread float64, seed uint32) Vec3 {
	if spread <= 0 {
		return aim
	}

	first := Xorshift32(seed)
	second := Xorshift32(first)
	across := float64(UnitFrom(first) * spread)
	up := float64(UnitFrom(second) * spread)

	// The axis the aim leans on least, so the cross product never collapses.
	hint := Vec3{X: 1, Y: 0, Z: 0}
	if math.Abs(aim.Y) < 0.9 {
		hint = Vec3{X: 0, Y: 1, Z: 0}
	}
	right := normaliseSpread(crossOf(aim, hint))
	over := crossOf(right, aim)

	return normaliseSpread(Vec3{
		X: aim.X + float64(right.X*across) + float64(over.X*up),
		Y: aim.Y + float64(right.Y*across) + float64(over.Y*up),
		Z: aim.Z + float64(right.Z*across) + float64(over.Z*up),
	})
}

func normaliseSpread(v Vec3) Vec3 {
	lengthSquared := float64(v.X*v.X) + float64(v.Y*v.Y) + float64(v.Z*v.Z)
	if lengthSquared <= 0 {
		return Vec3{X: 0, Y: 0, Z: 1}
	}
	length := math.Sqrt(lengthSquared)
	return Vec3{X: v.X / length, Y: v.Y / length, Z: v.Z / length}
}
