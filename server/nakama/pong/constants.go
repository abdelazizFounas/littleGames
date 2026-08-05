// Package pong holds the authoritative Pong simulation.
//
// It is a port of packages/games/pong/logic, kept in step with it by the shared
// conformance vectors both replay. TypeScript is the reference: change the
// rules there, regenerate the vectors, then mirror the change here until the Go
// test passes again.
//
// Every constant is a typed float64 so that Go's exact constant arithmetic
// cannot fold an expression differently from the way JavaScript rounds it at
// each step.
package pong

const (
	FieldWidth  float64 = 800
	FieldHeight float64 = 600
)

const (
	TickRate            = 30
	TickSeconds float64 = 1.0 / 30.0
)

const (
	PaddleWidth  float64 = 12
	PaddleHeight float64 = 96
	PaddleInset  float64 = 32
	PaddleSpeed  float64 = 420
)

const (
	LeftPaddleX  float64 = PaddleInset + PaddleWidth/2
	RightPaddleX float64 = FieldWidth - PaddleInset - PaddleWidth/2
)

const (
	BallRadius       float64 = 8
	BallInitialSpeed float64 = 330
	BallSpeedGain    float64 = 1.05
	BallMaxSpeed     float64 = 900
)

// MaxBounceRatio is the steepest vertical component a paddle can impart, as a
// fraction of the ball's speed. Strictly below 1 so a rally cannot stall into a
// vertical bounce nobody can reach.
const MaxBounceRatio float64 = 0.8

const WinningScore = 11

const (
	CountdownTicks  = 3 * TickRate
	PointPauseTicks = TickRate
)

// ServeVerticalRatios is cycled by point number rather than drawn at random, so
// that the server and every client produce the same serve from the same state.
var ServeVerticalRatios = [...]float64{0, 0.35, -0.35, 0.6, -0.6, 0.2, -0.2}
