package pong

// Phases a match moves through. The values match the TypeScript ones exactly,
// because both appear in the conformance vectors and on the wire.
const (
	PhaseWaiting     = "waiting"
	PhaseCountdown   = "countdown"
	PhasePlaying     = "playing"
	PhasePointScored = "pointScored"
	PhaseFinished    = "finished"
)

// Sides of the field.
const (
	SideLeft  = "left"
	SideRight = "right"
)

type Paddle struct {
	// Y is the centre of the paddle along the y axis.
	Y float64 `json:"y"`
}

type Ball struct {
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	VX float64 `json:"vx"`
	VY float64 `json:"vy"`
	// Speed is the magnitude of the velocity, carried so a bounce can rebuild
	// it exactly.
	Speed float64 `json:"speed"`
}

type Score struct {
	Left  int `json:"left"`
	Right int `json:"right"`
}

// PaddleInput is what one player is pressing. Intent only, no position.
type PaddleInput struct {
	Up   bool `json:"up"`
	Down bool `json:"down"`
}

// Inputs is both players' intent for a single tick.
type Inputs struct {
	Left  PaddleInput `json:"left"`
	Right PaddleInput `json:"right"`
}

// State is the complete simulation state.
//
// Every field is comparable, so two states can be checked for exact equality
// without a helper — which is what the conformance test relies on.
type State struct {
	Phase string `json:"phase"`
	// PhaseTicks is the number of ticks left in a timed phase, and zero
	// outside countdown and pointScored.
	PhaseTicks int    `json:"phaseTicks"`
	Left       Paddle `json:"left"`
	Right      Paddle `json:"right"`
	Ball       Ball   `json:"ball"`
	Score      Score  `json:"score"`
	// PointsPlayed chooses the serve angle.
	PointsPlayed int `json:"pointsPlayed"`
	// ServeTowards is the side the next serve travels towards.
	ServeTowards string `json:"serveTowards"`
	// Winner is empty until the match is over. JSON null decodes to empty.
	Winner string `json:"winner"`
}

func restingBall() Ball {
	return Ball{X: FieldWidth / 2, Y: FieldHeight / 2, VX: 0, VY: 0, Speed: BallInitialSpeed}
}

// NewState returns the state a match starts in, before anyone has joined.
func NewState() State {
	return State{
		Phase:        PhaseWaiting,
		PhaseTicks:   0,
		Left:         Paddle{Y: FieldHeight / 2},
		Right:        Paddle{Y: FieldHeight / 2},
		Ball:         restingBall(),
		Score:        Score{Left: 0, Right: 0},
		PointsPlayed: 0,
		ServeTowards: SideRight,
		Winner:       "",
	}
}

// StartCountdown begins the three-second countdown before the first rally.
func StartCountdown(state State) State {
	state.Phase = PhaseCountdown
	state.PhaseTicks = CountdownTicks
	state.Ball = restingBall()
	return state
}
