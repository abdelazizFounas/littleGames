// Package arena holds the authoritative Arena simulation.
//
// It is a port of packages/games/arena/logic, kept in step with it by the
// shared conformance vectors both replay. TypeScript is the reference: change
// the rules there, regenerate the vectors, then mirror the change here until
// the Go test passes again.
//
// Two disciplines run through the whole package, and both exist because a
// difference of one bit between this and the client is felt in first person as
// the camera being yanked out from under the player.
//
// Every constant is a typed float64, so Go's exact constant arithmetic cannot
// fold an expression somewhere JavaScript's step-by-step rounding does not.
//
// And every product that feeds an addition is wrapped in an explicit float64
// conversion. The Go specification allows an implementation to fuse a multiply
// and an add into one operation with a single rounding — the compiler does
// exactly that on arm64 — and an explicit conversion is the documented way to
// force the intermediate rounding that JavaScript always performs. Without it
// this package would agree with the client on an x86 server and disagree on an
// ARM one, which is the worst shape a bug can have.
package arena

const (
	// TickRate is the number of simulation steps a second, and Nakama's
	// ceiling. Sixty rather than Pong's thirty: what it buys is not a more
	// responsive camera, which turns at frame rate from local mouse deltas, but
	// a three-tick jitter buffer costing 50 ms instead of 100 — so the opponent
	// is half as stale, and every rewind is half as deep.
	TickRate            = 60
	TickSeconds float64 = 1.0 / 60.0
)

// Scales the wire quantises movement and aim onto.
//
// Powers of two, so dividing an integer by one of them is exact in binary
// floating point and lands on the identical double in both languages. That is
// what lets a client predict from the very integers it put on the wire.
const (
	MoveScale float64 = 1024
	AimScale  float64 = 8192
)

// Widest a quantised component may be before the server rejects the frame.
const (
	MaxWireMove int32 = 1024 * 2
	MaxWireAim  int32 = 8192 * 2
)

// The arena, in metres.
const (
	ZoneWidth float64 = 20
	ZoneDepth float64 = 10
	// GapDepth is the impassable middle. Bullets cross it; players never do.
	GapDepth float64 = 6

	HalfWidth float64 = ZoneWidth / 2
	// ZoneNearZ is the front edge of a zone: where the ravine starts.
	ZoneNearZ float64 = GapDepth / 2
	ZoneFarZ  float64 = ZoneNearZ + ZoneDepth

	WallHeight    float64 = 6
	WallThickness float64 = 1
)

// The player.
const (
	// PlayerHalf is half the width and half the depth of the body box.
	PlayerHalf float64 = 0.4

	StandHeight  float64 = 1.8
	CrouchHeight float64 = 1.1

	// StandEye is where the camera and the muzzle sit above the feet.
	StandEye  float64 = 1.6
	CrouchEye float64 = 0.9

	MoveSpeed   float64 = 5.5
	CrouchSpeed float64 = 2.4

	// Gravity is well above the 9.81 of the world it is pretending to be. Real
	// gravity makes a jump that clears a crate hang in the air for most of a
	// second, which reads as floating rather than as jumping.
	Gravity float64 = 22

	// JumpSpeed reaches about 1.22 m when integrated a tick at a time, which
	// clears a one-metre crate with enough margin to land on it while moving.
	JumpSpeed float64 = 7.5
)

// The stride.
const (
	// StrideMetres is how far a player travels in one full stride cycle. The
	// gait is driven by ground covered rather than by time, so a player pressed
	// against a wall stops stepping — they are not going anywhere.
	StrideMetres float64 = 2.4

	// WalkStepMetres is the ground covered in one tick at a full run — what a
	// whole step is measured against. Cover half of it, as a crouched walk
	// does, and the steps are half as long, with no separate rule for it.
	WalkStepMetres float64 = MoveSpeed * TickSeconds

	// GaitPowerPerTick is how fast the size of a step grows and shrinks.
	// Without it a player who stops mid-stride freezes with one leg out in
	// front, which reads as a statue of somebody walking rather than as
	// somebody standing.
	GaitPowerPerTick float64 = 0.12

	// CrouchPerTick is how much of the way into a crouch a body travels each
	// tick — about an eighth of a second end to end. Instant is cheaper, but a
	// hitbox that changes height between one tick and the next is a hitbox
	// nobody can see moving, and a player dropping behind cover ought to be
	// seen dropping.
	CrouchPerTick float64 = 0.14
)

// Shooting.
const (
	// FireCooldownTicks is the gap between one shot and the next being allowed.
	FireCooldownTicks = 24
	// MaxShotDistance is where the ray stops looking. Longer than the arena.
	MaxShotDistance float64 = 80
)

// Rounds.
const (
	RespawnTicks   = 90
	CountdownTicks = 3 * TickRate
	WinningScore   = 7
)

// Lag compensation.
const (
	// MaxRewindTicks is the furthest back the server will rewind a target to
	// judge a shot: 250 ms. Past that, the victim's complaint — being killed
	// after reaching cover — outgrows the shooter's claim that the target was
	// on their screen. It is also the depth of the history ring.
	MaxRewindTicks = 15

	// InterpDelayTicks is how far behind live a client draws the opponent.
	//
	// Part of the rules rather than of the client, because the server adds it
	// to every rewind: a shooter aimed at what their screen showed, and their
	// screen was this far behind the snapshot they held.
	InterpDelayTicks = 3
)
