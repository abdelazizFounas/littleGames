package arena

// Phases a match moves through. The values match the TypeScript ones exactly,
// because both appear in the conformance vectors.
const (
	PhaseWaiting   = "waiting"
	PhaseCountdown = "countdown"
	PhasePlaying   = "playing"
	PhaseFinished  = "finished"
)

// PlayerSim is one player, as the simulation holds them.
type PlayerSim struct {
	Body PlayerBody `json:"body"`
	// Aim is unit length, as the server latched it from the client's input.
	Aim   Vec3 `json:"aim"`
	Alive bool `json:"alive"`
	Score int  `json:"score"`
	// RespawnTicks counts down to nothing, then the player is put back at their
	// spawn.
	RespawnTicks int `json:"respawnTicks"`
	// SpawnEpoch is bumped every time this player is put back at their spawn.
	//
	// It is on the wire, and it is load-bearing twice over. The server refuses
	// to rewind a target across one, so nobody is killed a beat after
	// reappearing. The client throws away its unacknowledged inputs when one
	// changes, so it does not replay a dead player's movement on top of a fresh
	// spawn and skate out of it.
	SpawnEpoch    int `json:"spawnEpoch"`
	CooldownTicks int `json:"cooldownTicks"`
}

// HistoryFrame is both bodies as they stood at the end of one past tick.
type HistoryFrame struct {
	North      PlayerBody
	South      PlayerBody
	NorthAlive bool
	SouthAlive bool
	NorthEpoch int
	SouthEpoch int
}

// State is the complete simulation state.
type State struct {
	Phase      string    `json:"phase"`
	PhaseTicks int       `json:"phaseTicks"`
	Tick       int       `json:"tick"`
	North      PlayerSim `json:"north"`
	South      PlayerSim `json:"south"`
	// Winner is empty until the match is over. JSON null decodes to empty.
	Winner string `json:"winner"`
	// History is where both players were, for the last MaxRewindTicks ticks.
	//
	// Fixed length and written to in a circle, so the state has a size rather
	// than a growth rate. This is what lag compensation rewinds into: a shooter
	// is judged against where their target was on the shooter's screen, not
	// against where it has since got to.
	History [MaxRewindTicks]HistoryFrame `json:"-"`
	// HistoryAt is the index the newest frame was written at.
	HistoryAt  int `json:"-"`
	NextShotID int `json:"nextShotId"`
}

// Input is one player's intent for one tick, dequantised and ready to simulate.
type Input struct {
	Move   Vec2
	Aim    Vec3
	Jump   bool
	Crouch bool
	Fire   bool
	// RewindTicks is how far back this player's screen was, already clamped.
	RewindTicks int
}

// Inputs is both players' intent for a single tick.
type Inputs struct {
	North Input
	South Input
}

// NoInput is what a seat with nobody in it contributes.
var NoInput = Input{Move: Vec2{}, Aim: DefaultAim}

func spawn(seat string, epoch int) PlayerSim {
	return PlayerSim{
		Body:          RestingBody(Spawns[seat]),
		Aim:           SpawnAim[seat],
		Alive:         true,
		Score:         0,
		RespawnTicks:  0,
		SpawnEpoch:    epoch,
		CooldownTicks: 0,
	}
}

// Respawn puts a player back at their spawn, keeping their score and bumping
// the epoch.
func Respawn(player PlayerSim, seat string) PlayerSim {
	next := spawn(seat, player.SpawnEpoch+1)
	next.Score = player.Score
	return next
}

func emptyFrame() HistoryFrame {
	return HistoryFrame{
		North:      RestingBody(Spawns[SeatNorth]),
		South:      RestingBody(Spawns[SeatSouth]),
		NorthAlive: true,
		SouthAlive: true,
	}
}

// NewState returns the state a match starts in, before anyone has joined.
func NewState() State {
	state := State{
		Phase:      PhaseWaiting,
		North:      spawn(SeatNorth, 0),
		South:      spawn(SeatSouth, 0),
		NextShotID: 1,
	}
	for index := range state.History {
		state.History[index] = emptyFrame()
	}
	return state
}

// StartCountdown opens the countdown, once both seats are filled.
func StartCountdown(state State, countdownTicks int) State {
	if state.Phase != PhaseWaiting {
		return state
	}
	state.Phase = PhaseCountdown
	state.PhaseTicks = countdownTicks
	return state
}

// ClampRewind is how far back a shooter's view was, from the newest tick they
// said they held.
//
// seenTick comes from the client, which is why every part of this is clamped. A
// client that claims to have seen the future is pulled back to the present; one
// that claims a tick older than the ring is pulled forward to the oldest frame
// there is. Claiming to have seen less than it did is allowed and pointless —
// it only makes the shot resolve against fresher positions, which is to say
// against a target that has had longer to move away.
//
// The interpolation delay is added because the client draws the opponent that
// far behind the snapshot it holds, and it is the drawn opponent that was aimed
// at.
func ClampRewind(seenTick, currentTick int) int {
	behind := currentTick - seenTick
	if behind < 0 {
		behind = 0
	}
	total := behind + InterpDelayTicks
	if total > MaxRewindTicks-1 {
		return MaxRewindTicks - 1
	}
	return total
}

// HistoryAt reads the ring, back ticks before the newest frame written.
func HistoryAt(state State, back int) HistoryFrame {
	length := len(state.History)
	clamped := back
	if clamped < 0 {
		clamped = 0
	}
	if clamped > length-1 {
		clamped = length - 1
	}
	index := ((state.HistoryAt-clamped)%length + length) % length
	return state.History[index]
}

// PlayerOf returns one seat's player.
func PlayerOf(state State, seat string) PlayerSim {
	if seat == SeatNorth {
		return state.North
	}
	return state.South
}
