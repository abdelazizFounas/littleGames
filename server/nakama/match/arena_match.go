package match

import (
	"context"
	"database/sql"

	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/protobuf/proto"
	"littlegames.local/nakama/arena"
	arenav1 "littlegames.local/nakama/protocol/arenav1"
	"littlegames.local/nakama/stats"
)

// ArenaName is the handler name Nakama creates these matches under.
const ArenaName = "arena"

// ArenaTickRate is taken from the shared rules rather than declared again, so
// the server cannot tick at a rate the physics was not written for. Sixty is
// also Nakama's ceiling, and the rate the vectors were generated at.
const ArenaTickRate = arena.TickRate

// How long a finished match lingers so its result can be read, and how long an
// empty one is held open for a reconnection. Both in ticks, so both are written
// against this game's rate rather than inherited from a slower one.
const (
	arenaLingerTicks    = 30 * ArenaTickRate
	arenaGraceTicks     = 30 * ArenaTickRate
	arenaCountdownTicks = arena.CountdownTicks
)

// arenaQueueDepth is how many commands a player may run ahead of the server.
//
// A short queue is the point of having one at all: it absorbs the jitter that
// lands two commands in one tick, and it bounds how far ahead a client can run.
// Eight is 133 ms of intent, which is more than any connection worth playing on
// will bank, and past that the oldest are dropped.
const arenaQueueDepth = 8

// arenaShotWindow is how many recent shots ride along in every snapshot.
//
// Snapshots travel unreliably, and a tracer that appeared in one frame alone
// would sometimes never be seen. A window means a client that dropped a
// snapshot still draws the shot, and the ids tell it what it has already drawn.
const arenaShotWindow = 8

// arenaCommand is one tick of intent as it arrived, checked and dequantised but
// not yet interpreted.
//
// The raw form is kept rather than the simulation input because a starved queue
// repeats the last command, and re-deriving from the raw form is what makes the
// repeat mean "still holding these keys" instead of "fire again": the shot
// counter has already been caught up with by then, so the repeat fires nothing.
type arenaCommand struct {
	seq        uint32
	move       arena.Vec2
	aim        arena.Vec3
	jump       bool
	crouch     bool
	zoomed     bool
	seenTick   uint32
	shotsFired uint32
}

type arenaPlayer struct {
	presence runtime.Presence

	// Half of the arena this player holds, assigned on join.
	seat string

	// Commands waiting to be executed, oldest first.
	queue []arenaCommand
	// The last one executed, repeated when the queue starves.
	last  arenaCommand
	hasIn bool

	// Highest sequence number accepted. Echoed back so the client can discard
	// acknowledged commands and replay the rest.
	lastProcessedSeq uint32

	// Shots this player has been credited with, matched against the counter
	// they send.
	shotsAcked uint32

	zoomed bool
}

type arenaState struct {
	players map[string]*arenaPlayer

	// The authoritative simulation. The server owns the only copy that counts.
	sim arena.State

	// The last few shots resolved, newest last.
	shots []*arenav1.ShotEvent

	label    Label
	password string
	matchID  string

	emptySince int64
	finishedAt int64
	recorded   bool
}

// ArenaMatch is the authoritative handler for a 1v1 Arena match.
type ArenaMatch struct{}

var _ runtime.Match = (*ArenaMatch)(nil)

func (m *ArenaMatch) MatchInit(
	_ context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	params map[string]interface{},
) (interface{}, int, string) {
	password, _ := params["password"].(string)
	host, _ := params["host"].(string)
	if host == "" {
		host = "someone"
	}

	locked := "no"
	if password != "" {
		locked = "yes"
	}

	// The rate Nakama accepted is worth a line in the log: it is the number
	// every constant in the simulation was tuned against, and Nakama refuses
	// anything outside 1..60 by returning an error the handler never sees.
	logger.Info("Arena lobby opened by %s at %d Hz, locked=%s", host, ArenaTickRate, locked)

	state := &arenaState{
		players:    make(map[string]*arenaPlayer, Capacity),
		sim:        arena.NewState(),
		label:      Label{Game: ArenaName, State: StateWaiting, Locked: locked, Host: host},
		password:   password,
		emptySince: -1,
		finishedAt: -1,
	}
	return state, ArenaTickRate, state.label.encode()
}

func (m *ArenaMatch) MatchJoinAttempt(
	_ context.Context,
	_ runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	_ runtime.MatchDispatcher,
	_ int64,
	state interface{},
	presence runtime.Presence,
	metadata map[string]string,
) (interface{}, bool, string) {
	current, ok := state.(*arenaState)
	if !ok {
		return state, false, "invalid match state"
	}
	// Already seated: a reconnection returns to its own seat rather than being
	// refused as a duplicate, and is not asked for the password again.
	if _, alreadyIn := current.players[presence.GetUserId()]; alreadyIn {
		return current, true, ""
	}
	if current.sim.Phase == arena.PhaseFinished {
		return current, false, "that match is already over"
	}
	if len(current.players) >= Capacity {
		return current, false, "match is full"
	}
	if current.password != "" && metadata["password"] != current.password {
		return current, false, "that lobby needs the right password"
	}
	return current, true, ""
}

func (m *ArenaMatch) MatchJoin(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	dispatcher runtime.MatchDispatcher,
	_ int64,
	state interface{},
	presences []runtime.Presence,
) interface{} {
	current, ok := state.(*arenaState)
	if !ok {
		return state
	}
	if current.matchID == "" {
		if id, found := ctx.Value(runtime.RUNTIME_CTX_MATCH_ID).(string); found {
			current.matchID = id
		}
	}

	for _, presence := range presences {
		if seated, alreadyIn := current.players[presence.GetUserId()]; alreadyIn {
			// Same player on a new socket — a reload, or a reconnection. They
			// keep their seat, their score and their acknowledged input; only
			// the socket to send to changes.
			seated.presence = presence
			logger.Info("Player %s rejoined on a new socket", presence.GetUsername())
			continue
		}
		current.players[presence.GetUserId()] = &arenaPlayer{
			presence: presence,
			seat:     current.freeSeat(),
			queue:    make([]arenaCommand, 0, arenaQueueDepth),
		}
		logger.Info("Player %s joined the match", presence.GetUsername())
		rememberMatchFor(ctx, logger, nk, presence.GetUserId(), current.matchID, current.label, current.password)
	}

	// The countdown opens as soon as both seats are taken, and only from
	// waiting: a rejoin mid-match must not restart the match.
	if len(current.players) == Capacity && current.sim.Phase == arena.PhaseWaiting {
		current.sim = arena.StartCountdown(current.sim, arenaCountdownTicks)
		logger.Info("Both players present, starting the countdown")
		current.relabel(logger, dispatcher, StatePlaying)
	}

	return current
}

// freeSeat returns whichever half of the arena nobody holds yet.
func (s *arenaState) freeSeat() string {
	for _, seated := range s.players {
		if seated.seat == arena.SeatNorth {
			return arena.SeatSouth
		}
	}
	return arena.SeatNorth
}

func (s *arenaState) relabel(logger runtime.Logger, dispatcher runtime.MatchDispatcher, state string) {
	s.label.State = state
	if err := dispatcher.MatchLabelUpdate(s.label.encode()); err != nil {
		logger.Error("Failed to update the lobby label: %v", err)
	}
}

func (m *ArenaMatch) MatchLeave(
	_ context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	_ runtime.MatchDispatcher,
	_ int64,
	state interface{},
	presences []runtime.Presence,
) interface{} {
	current, ok := state.(*arenaState)
	if !ok {
		return state
	}
	for _, presence := range presences {
		seated, stillIn := current.players[presence.GetUserId()]
		// Only the socket actually holding the seat may vacate it, so a player
		// who reloaded is not evicted by the departure of the socket they
		// already replaced.
		if !stillIn || seated.presence.GetSessionId() != presence.GetSessionId() {
			logger.Info("Ignored a leave from a socket that no longer holds a seat")
			continue
		}
		delete(current.players, presence.GetUserId())
		logger.Info("Player %s left the match", presence.GetUsername())
	}
	return current
}

func (m *ArenaMatch) MatchLoop(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	dispatcher runtime.MatchDispatcher,
	tick int64,
	state interface{},
	messages []runtime.MatchData,
) interface{} {
	current, ok := state.(*arenaState)
	if !ok {
		return state
	}

	// Held open with nobody in it, so a player crossing between Wi-Fi and
	// mobile data pauses rather than forfeits; closed once nobody comes back.
	if len(current.players) == 0 {
		if current.emptySince < 0 {
			current.emptySince = tick
		}
		if tick-current.emptySince > arenaGraceTicks {
			logger.Info("Nobody came back, closing the match")
			return nil
		}
	} else {
		current.emptySince = -1
	}

	current.enqueue(logger, messages)

	before := current.sim.Phase
	next, shots := arena.Step(current.sim, current.consume())
	current.sim = next
	current.rememberShots(shots)

	if current.sim.Phase == arena.PhaseFinished && before != arena.PhaseFinished && !current.recorded {
		current.recorded = true
		current.finishedAt = tick
		stats.RecordMatch(ctx, logger, nk, current.label.Game, current.outcomes())

		// Out of the listings straight away, so nobody looking for a game is
		// sent to a table that has already been won, and out of everyone's
		// resume list, because a finished match is not one to come back to.
		current.relabel(logger, dispatcher, StateOver)
		forgetMatchFor(ctx, logger, nk, current.matchID, current.playerIDs())
	}

	if current.finishedAt >= 0 && tick-current.finishedAt > arenaLingerTicks {
		logger.Info("Finished match has been read, closing it")
		return nil
	}

	if err := current.broadcast(dispatcher); err != nil {
		logger.Error("Failed to broadcast snapshot: %v", err)
	}

	return current
}

func (m *ArenaMatch) MatchTerminate(
	_ context.Context, logger runtime.Logger, _ *sql.DB, _ runtime.NakamaModule,
	_ runtime.MatchDispatcher, _ int64, state interface{}, graceSeconds int,
) interface{} {
	logger.Info("Arena match terminating, %d seconds of grace", graceSeconds)
	return state
}

func (m *ArenaMatch) MatchSignal(
	_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule,
	_ runtime.MatchDispatcher, _ int64, state interface{}, data string,
) (interface{}, string) {
	current, ok := state.(*arenaState)
	if !ok {
		return state, SignalRefused
	}
	if current.sim.Phase == arena.PhaseFinished || len(current.players) >= Capacity {
		return current, SignalRefused
	}
	if current.password != "" && data != current.password {
		return current, SignalRefused
	}
	return current, SignalOK
}

// clampWire pulls a quantised component back inside the range the protocol
// allows.
//
// Clamped rather than rejected. A frame is a whole tick of intent, and throwing
// one away because one component was wide would stop the player dead; the value
// is brought back to something legal and the speed cap in the rules does the
// rest.
func clampWire(value, limit int32) int32 {
	if value < -limit {
		return -limit
	}
	if value > limit {
		return limit
	}
	return value
}

// enqueue folds this tick's client messages into each player's command queue.
//
// Nothing here is trusted: the sequence number must move forward, every
// quantised component is clamped into range, and the queue has a fixed depth. A
// client that floods it has its oldest commands dropped, which is the only sane
// answer and costs it nothing it did not deserve.
func (s *arenaState) enqueue(logger runtime.Logger, messages []runtime.MatchData) {
	for _, message := range messages {
		if message.GetOpCode() != int64(arenav1.OpCode_OP_CODE_PLAYER_INPUT) {
			continue
		}

		seated, known := s.players[message.GetUserId()]
		if !known {
			continue
		}

		var input arenav1.PlayerInput
		if err := proto.Unmarshal(message.GetData(), &input); err != nil {
			logger.Warn("Discarded a malformed input from %s: %v", message.GetUsername(), err)
			continue
		}

		// Out of order or already seen. Commands arrive over an unreliable
		// path, so a duplicate is expected rather than suspicious — it is
		// simply nothing new.
		if input.GetSeq() <= seated.lastProcessedSeq {
			continue
		}
		seated.lastProcessedSeq = input.GetSeq()

		command := arenaCommand{
			seq: input.GetSeq(),
			move: arena.MoveFromWire(
				clampWire(input.GetMoveX(), arena.MaxWireMove),
				clampWire(input.GetMoveZ(), arena.MaxWireMove),
			),
			aim: arena.AimFromWire(
				clampWire(input.GetAimX(), arena.MaxWireAim),
				clampWire(input.GetAimY(), arena.MaxWireAim),
				clampWire(input.GetAimZ(), arena.MaxWireAim),
			),
			jump:       input.GetJump(),
			crouch:     input.GetCrouch(),
			zoomed:     input.GetZoomed(),
			seenTick:   input.GetSeenTick(),
			shotsFired: input.GetShotsFired(),
		}

		seated.push(command)
	}
}

// push adds a command to the queue, dropping the oldest when it is full.
//
// The oldest rather than the newest: a queue that has run deep is a queue whose
// front is already stale, and the point of holding commands at all is to have
// the freshest intent ready for the next tick.
func (p *arenaPlayer) push(command arenaCommand) {
	if len(p.queue) >= arenaQueueDepth {
		p.queue = p.queue[1:]
	}
	p.queue = append(p.queue, command)
}

// consume takes exactly one command from each player's queue.
//
// Exactly one, every tick, is the whole reason the queue exists. Pong latches
// instead: the newest command wins and is reapplied until another arrives, so
// under jitter two commands landing in one tick means one is silently dropped
// and the client predicted a step the server never took. For a paddle that is
// an invisible correction; in first person it is the camera jolting.
func (s *arenaState) consume() arena.Inputs {
	inputs := arena.Inputs{North: arena.NoInput, South: arena.NoInput}

	for _, seated := range s.players {
		command, running := seated.take()
		if !running {
			continue
		}

		// A shot is claimed by a counter rather than by a flag, so a duplicated
		// command cannot fire twice and a lost one is made good by the next to
		// arrive. Catching the counter all the way up rather than one at a time
		// is what stops a client banking shots to spend in a burst: the credit
		// is one shot, whatever the jump.
		fire := command.shotsFired > seated.shotsAcked
		if fire {
			seated.shotsAcked = command.shotsFired
		}
		seated.zoomed = command.zoomed

		input := arena.Input{
			Move:   command.move,
			Aim:    command.aim,
			Jump:   command.jump,
			Crouch: command.crouch,
			Fire:   fire,
			// How far back this player's screen was. seenTick is theirs to
			// claim, so it is judged against the tick the server is actually
			// on: claiming the future buys nothing, claiming the distant past
			// is capped, and claiming less than the truth only resolves the
			// shot against a target that has had longer to move away.
			RewindTicks: arena.ClampRewind(int(command.seenTick), s.sim.Tick),
		}

		if seated.seat == arena.SeatNorth {
			inputs.North = input
		} else {
			inputs.South = input
		}
	}

	return inputs
}

// take returns the next command to execute, repeating the last one when the
// queue has starved.
//
// Repeating is what a missing packet should mean: a player holding a key does
// not stop holding it because a datagram was lost. It is the raw command that
// repeats, so the shot counter is re-read and the repeat fires nothing.
func (p *arenaPlayer) take() (arenaCommand, bool) {
	if len(p.queue) > 0 {
		p.last = p.queue[0]
		p.queue = p.queue[1:]
		p.hasIn = true
	}
	return p.last, p.hasIn
}

// rememberShots keeps the trailing window every snapshot carries.
func (s *arenaState) rememberShots(shots []arena.ShotEvent) {
	for _, shot := range shots {
		s.shots = append(s.shots, &arenav1.ShotEvent{
			Id:        uint32(shot.ID),
			Shooter:   seatToProto(shot.Shooter),
			Origin:    vectorToProto(shot.Origin),
			Endpoint:  vectorToProto(shot.Endpoint),
			HitPlayer: shot.HitPlayer,
		})
	}
	if len(s.shots) > arenaShotWindow {
		s.shots = s.shots[len(s.shots)-arenaShotWindow:]
	}
}

func (s *arenaState) playerIDs() []string {
	ids := make([]string, 0, len(s.players))
	for id := range s.players {
		ids = append(ids, id)
	}
	return ids
}

// outcomes turns the finished simulation into one result per player.
func (s *arenaState) outcomes() []stats.Outcome {
	results := make([]stats.Outcome, 0, len(s.players))
	for _, seated := range s.players {
		own := arena.PlayerOf(s.sim, seated.seat).Score
		against := arena.PlayerOf(s.sim, arena.OpponentOf(seated.seat)).Score
		results = append(results, stats.Outcome{
			UserID:        seated.presence.GetUserId(),
			Username:      seated.presence.GetUsername(),
			Won:           s.sim.Winner == seated.seat,
			PointsFor:     own,
			PointsAgainst: against,
		})
	}
	return results
}

func arenaPhaseToProto(phase string) arenav1.Phase {
	switch phase {
	case arena.PhaseWaiting:
		return arenav1.Phase_PHASE_WAITING
	case arena.PhaseCountdown:
		return arenav1.Phase_PHASE_COUNTDOWN
	case arena.PhasePlaying:
		return arenav1.Phase_PHASE_PLAYING
	case arena.PhaseFinished:
		return arenav1.Phase_PHASE_FINISHED
	default:
		return arenav1.Phase_PHASE_UNSPECIFIED
	}
}

func seatToProto(seat string) arenav1.Seat {
	switch seat {
	case arena.SeatNorth:
		return arenav1.Seat_SEAT_NORTH
	case arena.SeatSouth:
		return arenav1.Seat_SEAT_SOUTH
	default:
		return arenav1.Seat_SEAT_UNSPECIFIED
	}
}

func vectorToProto(vector arena.Vec3) *arenav1.Vector3 {
	return &arenav1.Vector3{X: vector.X, Y: vector.Y, Z: vector.Z}
}

// broadcast sends the authoritative state to everyone in the match.
func (s *arenaState) broadcast(dispatcher runtime.MatchDispatcher) error {
	if len(s.players) == 0 {
		return nil
	}

	snapshot := &arenav1.Snapshot{
		// The simulation's own tick, not Nakama's loop counter. This is the
		// number a client echoes back as the moment it drew, and the number
		// every rewind is measured from, so the two must be the same clock.
		Tick:       uint32(s.sim.Tick),
		Phase:      arenaPhaseToProto(s.sim.Phase),
		PhaseTicks: uint32(s.sim.PhaseTicks),
		Players:    make([]*arenav1.PlayerState, 0, len(s.players)),
		Winner:     seatToProto(s.sim.Winner),
		Shots:      s.shots,
	}

	for _, seated := range s.players {
		simulated := arena.PlayerOf(s.sim, seated.seat)
		snapshot.Players = append(snapshot.Players, &arenav1.PlayerState{
			UserId:           seated.presence.GetUserId(),
			Username:         seated.presence.GetUsername(),
			Seat:             seatToProto(seated.seat),
			LastProcessedSeq: seated.lastProcessedSeq,
			// The body travels whole, including the vertical speed and the
			// crouch: this is where a client's prediction restarts from, and
			// replaying unacknowledged commands from a body missing its
			// vertical speed would put the player back on the ground mid-jump.
			Body: &arenav1.Body{
				X:         simulated.Body.X,
				Y:         simulated.Body.Y,
				Z:         simulated.Body.Z,
				Vy:        simulated.Body.VY,
				Grounded:  simulated.Body.Grounded,
				Crouching: simulated.Body.Crouching,
			},
			Aim:           vectorToProto(simulated.Aim),
			Alive:         simulated.Alive,
			Score:         uint32(simulated.Score),
			RespawnTicks:  uint32(simulated.RespawnTicks),
			CooldownTicks: uint32(simulated.CooldownTicks),
			SpawnEpoch:    uint32(simulated.SpawnEpoch),
			Zoomed:        seated.zoomed,
		})
	}

	payload, err := proto.Marshal(snapshot)
	if err != nil {
		return err
	}

	// Unreliable: a snapshot is a complete picture of the present, so a dropped
	// one is replaced by the next 17 ms later. Retransmitting it would deliver
	// stale state late, which is worse than not delivering it — and it is why
	// the shots ride along in a window rather than only on the tick they fired.
	return dispatcher.BroadcastMessage(
		int64(arenav1.OpCode_OP_CODE_SNAPSHOT),
		payload,
		nil,
		nil,
		false,
	)
}
