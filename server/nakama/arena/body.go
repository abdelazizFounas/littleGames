package arena

import "math"

// How a body moves, and the only rule the client runs as well as the server.
//
// Prediction replays this exact function over unacknowledged commands, so any
// difference between the two implementations shows up as the camera being
// corrected — a jolt in first person, where the camera is the player. The
// conformance vectors exist to make that impossible rather than unlikely.
//
// Nothing here needs a square root or a trigonometric function. Axes resolve
// one at a time, so a resolution is a comparison and an assignment.

// Bounds is an axis-aligned box. Everything in this game is one.
type Bounds struct {
	MinX float64
	MinY float64
	MinZ float64
	MaxX float64
	MaxY float64
	MaxZ float64
}

// PlayerBody is where a player is and what they are doing with their legs.
type PlayerBody struct {
	// X, Y and Z are the feet, not the eyes: the box stands on this point.
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
	// VY is the vertical speed. Horizontal speed is not carried — there is no
	// inertia.
	VY        float64 `json:"vy"`
	Grounded  bool    `json:"grounded"`
	Crouching bool    `json:"crouching"`
	// GaitPhase is where this body is in its stride, from zero to one.
	//
	// In the rules rather than in the renderer, and that is the point: the limbs
	// that get drawn are the limbs that get shot at, so both sides have to agree
	// on where they are.
	GaitPhase float64 `json:"gaitPhase"`
	// GaitPower is how much of a stride this body is taking, from standing
	// still to a full run.
	//
	// The phase alone cannot say this. A walk has its feet together only halfway
	// through a step, and at that moment the other foot is at the top of its
	// swing, so there is no phase at which a walking figure is also a standing
	// one. The size of the step is carried separately and falls to nothing when
	// a player stops.
	GaitPower float64 `json:"gaitPower"`
	// CrouchAmount is how far into a crouch this body is, standing to fully
	// down. A number rather than a flag, so the body has somewhere to be
	// between the two: height, eye and hitbox all follow it.
	CrouchAmount float64 `json:"crouchAmount"`
}

// settleCrouch moves a body one tick further into a crouch, or out of it.
func settleCrouch(amount float64, crouching bool) float64 {
	target := 0.0
	if crouching {
		target = 1
	}
	gap := target - amount
	if gap > CrouchPerTick {
		return amount + CrouchPerTick
	}
	if gap < -CrouchPerTick {
		return amount - CrouchPerTick
	}
	return target
}

// nextGait advances the stride by the ground actually covered, or settles it.
//
// Only while grounded: legs that keep striding through a jump look like running
// in mid-air, which is a thing cartoons do and shooters do not.
func nextGait(phase, travelled float64, grounded bool) float64 {
	if !grounded || travelled <= 0 {
		return phase
	}
	advanced := phase + travelled/StrideMetres
	// Wrapped by subtraction rather than by a modulo: exact in both languages,
	// and one tick can never span a whole stride.
	if advanced >= 1 {
		return advanced - 1
	}
	return advanced
}

// nextGaitPower moves the size of the step toward what this tick's speed
// deserves.
//
// Full ground covered in a tick is a full stride; a crouched walk covers less
// and takes correspondingly shorter steps, with no separate rule for it. Off
// the ground or stopped, it falls to nothing over a few ticks, which is what
// puts a stationary player's feet together and straightens their legs.
func nextGaitPower(power, travelled float64, grounded bool) float64 {
	target := 0.0
	if grounded && travelled > 0 {
		target = travelled / WalkStepMetres
		if target > 1 {
			target = 1
		}
	}
	gap := target - power
	if gap > GaitPowerPerTick {
		return power + GaitPowerPerTick
	}
	if gap < -GaitPowerPerTick {
		return power - GaitPowerPerTick
	}
	return target
}

// MoveIntent is one tick of intent, with the move already shortened to at most
// unit length.
type MoveIntent struct {
	Move   Vec2
	Jump   bool
	Crouch bool
}

// BodyHeight is how tall a body stands, at either end of a crouch or anywhere
// between.
func BodyHeight(crouchAmount float64) float64 {
	return StandHeight + float64((CrouchHeight-StandHeight)*crouchAmount)
}

// EyeHeight is how far the eyes sit above the feet.
func EyeHeight(crouchAmount float64) float64 {
	return StandEye + float64((CrouchEye-StandEye)*crouchAmount)
}

// EyePosition is where a body's eyes are, which is where the camera sits.
func EyePosition(body PlayerBody) Vec3 {
	return Vec3{X: body.X, Y: body.Y + EyeHeight(body.CrouchAmount), Z: body.Z}
}

// BodyBounds is the box a body occupies, which is also the box a bullet has to
// hit.
func BodyBounds(body PlayerBody) Bounds {
	return boundsAt(body.X, body.Y, body.Z, BodyHeight(body.CrouchAmount))
}

func boundsAt(x, y, z, height float64) Bounds {
	return Bounds{
		MinX: x - PlayerHalf,
		MinY: y,
		MinZ: z - PlayerHalf,
		MaxX: x + PlayerHalf,
		MaxY: y + height,
		MaxZ: z + PlayerHalf,
	}
}

func overlapsCollider(candidate Bounds, collider Box) bool {
	return candidate.MinX < collider.MaxX &&
		candidate.MaxX > collider.MinX &&
		candidate.MinY < collider.MaxY &&
		candidate.MaxY > collider.MinY &&
		candidate.MinZ < collider.MaxZ &&
		candidate.MaxZ > collider.MinZ
}

func hitsAnything(candidate Bounds) bool {
	for _, collider := range Colliders {
		if overlapsCollider(candidate, collider) {
			return true
		}
	}
	return false
}

// resolveAxis returns where an axis ends up after being pushed out of
// everything it entered.
//
// The overlap is tested against the unresolved position for every collider, and
// the most restrictive push wins. Resolving against one box and then re-testing
// against the next would make the answer depend on the order the boxes happen
// to be in, which is exactly the kind of thing that agrees in TypeScript and
// disagrees in Go.
//
// pick names the face to stop against, given a box that was entered.
func resolveAxis(moved Bounds, target float64, forward bool, pick func(Box) float64) float64 {
	resolved := target
	for _, collider := range Colliders {
		if !overlapsCollider(moved, collider) {
			continue
		}
		stop := pick(collider)
		if forward && stop < resolved || !forward && stop > resolved {
			resolved = stop
		}
	}
	return resolved
}

// StepBody advances one body by a tick.
//
// Axes resolve X, then Z, then Y, and Grounded comes out of the Y pass. That
// order is load-bearing: it is what lets a body slide along a crate face
// instead of stopping dead against it, and the TypeScript reference resolves in
// the same order. A dedicated vector scenario walks a body into every face and
// every inside corner in the arena to hold the two together.
func StepBody(body PlayerBody, intent MoveIntent) PlayerBody {
	// Crouching is granted on request and only released when there is room. A
	// player who ducks under a ledge and lets go of the key stays crouched
	// until they walk out from under it, rather than standing up through it.
	crouching := body.Crouching
	switch {
	case intent.Crouch:
		crouching = true
	case crouching && !hitsAnything(boundsAt(body.X, body.Y, body.Z, StandHeight)):
		crouching = false
	}

	// Part way down counts as down for what it costs: the height a body occupies
	// follows the movement rather than waiting for it to finish.
	crouchAmount := settleCrouch(body.CrouchAmount, crouching)
	height := BodyHeight(crouchAmount)
	speed := MoveSpeed
	if crouching {
		speed = CrouchSpeed
	}

	x, y, z := body.X, body.Y, body.Z

	dx := float64(intent.Move.X * speed * TickSeconds)
	if dx != 0 {
		moved := x + dx
		x = resolveAxis(boundsAt(moved, y, z, height), moved, dx > 0, func(collider Box) float64 {
			if dx > 0 {
				return collider.MinX - PlayerHalf
			}
			return collider.MaxX + PlayerHalf
		})
	}

	dz := float64(intent.Move.Z * speed * TickSeconds)
	if dz != 0 {
		moved := z + dz
		z = resolveAxis(boundsAt(x, y, moved, height), moved, dz > 0, func(collider Box) float64 {
			if dz > 0 {
				return collider.MinZ - PlayerHalf
			}
			return collider.MaxZ + PlayerHalf
		})
	}

	// A jump is read before gravity, so the impulse survives the tick it was
	// asked for. Held rather than edge-triggered: holding the key hops, which
	// is one fewer piece of state to keep in step across two languages.
	vy := body.VY
	if intent.Jump && body.Grounded {
		vy = JumpSpeed
	}
	vy -= Gravity * TickSeconds

	dy := float64(vy * TickSeconds)
	grounded := false
	if dy != 0 {
		moved := y + dy
		resolved := resolveAxis(boundsAt(x, moved, z, height), moved, dy > 0, func(collider Box) float64 {
			if dy > 0 {
				return collider.MinY - height
			}
			return collider.MaxY
		})
		if resolved != moved {
			// Stopped by something. Downwards that is the ground; upwards it is
			// a ceiling, and either way the vertical speed is spent.
			grounded = dy < 0
			vy = 0
		}
		y = resolved
	}

	// Measured from where the body ended up, not from where it meant to go: a
	// player walking into a wall covers no ground and takes no steps.
	travelledX := x - body.X
	travelledZ := z - body.Z
	travelled := math.Sqrt(float64(travelledX*travelledX) + float64(travelledZ*travelledZ))

	return PlayerBody{
		X: x, Y: y, Z: z,
		VY:           vy,
		Grounded:     grounded,
		Crouching:    crouching,
		CrouchAmount: crouchAmount,
		GaitPhase:    nextGait(body.GaitPhase, travelled, grounded),
		GaitPower:    nextGaitPower(body.GaitPower, travelled, grounded),
	}
}

// RestingBody is a body standing still at a spawn point, which is how every
// life starts.
func RestingBody(at Vec3) PlayerBody {
	return PlayerBody{
		X: at.X, Y: at.Y, Z: at.Z,
		VY: 0, Grounded: false, Crouching: false,
		CrouchAmount: 0,
		GaitPhase:    0,
		GaitPower:    0,
	}
}
