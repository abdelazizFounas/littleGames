package arena

import "math"

// Vec2 is movement intent: across the arena and along it. There is no vertical
// intent.
type Vec2 struct {
	X float64 `json:"x"`
	Z float64 `json:"z"`
}

// Vec3 is a point or a direction in the world.
type Vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// DefaultAim is used when a client sends something degenerate. Down the arena.
var DefaultAim = Vec3{X: 0, Y: 0, Z: 1}

// FromWire turns a quantised wire integer back into a number.
//
// Exact: the scale is a power of two, so this is an exponent adjustment and
// nothing is rounded. Both languages land on the identical double, which is the
// whole reason the wire carries integers.
func FromWire(quantised int32, scale float64) float64 {
	return float64(quantised) / scale
}

// MoveFromWire dequantises a movement vector.
func MoveFromWire(x, z int32) Vec2 {
	return Vec2{X: FromWire(x, MoveScale), Z: FromWire(z, MoveScale)}
}

// AimFromWire dequantises an aim vector, before it is normalised.
func AimFromWire(x, y, z int32) Vec3 {
	return Vec3{X: FromWire(x, AimScale), Y: FromWire(y, AimScale), Z: FromWire(z, AimScale)}
}

// ClampToUnit shortens a move to at most unit length, leaving a shorter one
// alone.
//
// This is the speed cap, and it is the only thing standing between the server
// and a client that claims to be pushing its stick twice as far as a stick
// goes. Shortening rather than rejecting is deliberate: an analogue stick at
// half deflection is a legitimate half-speed walk, and a touch joystick
// produces those constantly.
func ClampToUnit(move Vec2) Vec2 {
	lengthSquared := float64(move.X*move.X) + float64(move.Z*move.Z)
	if lengthSquared <= 1 {
		return move
	}
	length := math.Sqrt(lengthSquared)
	return Vec2{X: move.X / length, Z: move.Z / length}
}

// NormalizeAim returns a unit-length aim, or a fixed fallback when the client
// sent a degenerate one.
//
// A zero vector has no direction to normalise, and a ray without a direction
// would divide its way to infinities in the slab test. The fallback is a fixed
// direction rather than the previous aim so that this stays a pure function of
// its argument, which is what lets it go in the vectors.
func NormalizeAim(aim Vec3) Vec3 {
	lengthSquared := float64(aim.X*aim.X) + float64(aim.Y*aim.Y) + float64(aim.Z*aim.Z)
	if lengthSquared <= 0 {
		return DefaultAim
	}
	length := math.Sqrt(lengthSquared)
	return Vec3{X: aim.X / length, Y: aim.Y / length, Z: aim.Z / length}
}
