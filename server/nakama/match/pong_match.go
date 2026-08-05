// Package match holds the authoritative match handlers.
package match

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/protobuf/proto"
	"littlegames.local/nakama/pong"
	"littlegames.local/nakama/stats"
	matchv1 "littlegames.local/nakama/protocol/matchv1"
)

// PongName is the handler name Nakama creates matches under.
const PongName = "pong"

// TickRate is the number of authoritative steps per second.
//
// Taken from the shared rules rather than declared again here, so the server
// cannot tick at a rate the physics was not written for.
const TickRate = pong.TickRate

// ActiveCollection remembers, per player, the matches they are part of.
//
// Readable by its owner and writable by nobody, so a player sees their own
// games and cannot invent one. It is what lets someone who walked away come
// back to a match still in progress.
const ActiveCollection = "active"

// Lobby states, as they appear in the label listings are filtered on.
const (
	StateWaiting = "waiting"
	StatePlaying = "playing"
	StateOver    = "over"
)

// Label is what a match advertises about itself.
//
// It is public: anyone can list it. The password is deliberately absent — only
// whether there is one — because a lobby's lock is meant to keep people out,
// not to publish the key beside the door.
type Label struct {
	Game   string `json:"game"`
	State  string `json:"state"`
	Locked string `json:"locked"`
	Host   string `json:"host"`
}

func (l Label) encode() string {
	encoded, err := json.Marshal(l)
	if err != nil {
		// A label that will not encode would make the match invisible; the bare
		// game name still lists it, which is the better failure.
		return PongName
	}
	return string(encoded)
}

// FinishedLingerTicks is how long a finished match keeps running so its result
// can be read, before it closes on its own.
const FinishedLingerTicks = 30 * TickRate

// ReconnectGraceTicks is how long a match survives with nobody in it.
//
// A player crossing between Wi-Fi and mobile data disappears for a few seconds.
// Closing the match the moment the last socket drops would turn every handover
// into a forfeit, so the seats are held open and the simulation keeps running.
const ReconnectGraceTicks = 30 * TickRate

// Capacity is how many players a match holds. Extra joiners are turned away
// rather than queued.
const Capacity = 2

// player is one participant, as the server tracks them.
type player struct {
	presence runtime.Presence

	// End of the field this player defends, assigned on join.
	side string

	// Latest input the server has accepted from this player.
	up   bool
	down bool

	// Highest sequence number accepted so far. Echoed back so the client can
	// discard acknowledged inputs and replay the rest.
	lastProcessedSeq uint32
}

// matchState is the authoritative state. Nakama passes it between callbacks and
// never touches it, so it is only ever read and written on the match loop.
type matchState struct {
	players map[string]*player

	// The authoritative simulation. The server owns the only copy that counts.
	sim pong.State

	// Tick the match last had nobody in it, or -1 while somebody is.
	emptySince int64

	// Tick the match finished on, or -1 while it is still being played.
	finishedAt int64

	// What this lobby advertises, and the secret it does not.
	label    Label
	password string

	// This match's own id, learned on the first join.
	matchID string

	// Whether the result has been written. The match keeps ticking after it
	// finishes, so without this it would be recorded thirty times a second.
	recorded bool

	// Presence list rebuilt whenever membership changes, so the loop does not
	// allocate one every tick.
	broadcastTargets []runtime.Presence
}

// PongMatch is the authoritative handler for a Pong match.
type PongMatch struct{}

// Ensure the handler satisfies the interface Nakama type-asserts against.
var _ runtime.Match = (*PongMatch)(nil)

func (m *PongMatch) MatchInit(
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

	logger.Info("Pong lobby opened by %s at %d Hz, locked=%s", host, TickRate, locked)

	state := &matchState{
		players:          make(map[string]*player, Capacity),
		broadcastTargets: make([]runtime.Presence, 0, Capacity),
		sim:              pong.NewState(),
		emptySince:       -1,
		finishedAt:       -1,
		password:         password,
		label:            Label{Game: PongName, State: StateWaiting, Locked: locked, Host: host},
	}

	// The label is what listings search on, and all a lobby says about itself.
	return state, TickRate, state.label.encode()
}

func (m *PongMatch) MatchJoinAttempt(
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
	current, ok := state.(*matchState)
	if !ok {
		return state, false, "invalid match state"
	}

	// Accept a player who is already in: this is how a reconnection gets back
	// to its own seat instead of being refused as a duplicate.
	if _, alreadyIn := current.players[presence.GetUserId()]; alreadyIn {
		return current, true, ""
	}

	if current.sim.Phase == pong.PhaseFinished {
		return current, false, "that match is already over"
	}

	if len(current.players) >= Capacity {
		return current, false, "match is full"
	}

	// Checked here rather than in a listing filter: a filter is a convenience,
	// and anyone holding a match id could skip it. This is the actual door.
	if current.password != "" && metadata["password"] != current.password {
		return current, false, "that lobby needs the right password"
	}

	return current, true, ""
}

func (m *PongMatch) MatchJoin(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	dispatcher runtime.MatchDispatcher,
	_ int64,
	state interface{},
	presences []runtime.Presence,
) interface{} {
	current, ok := state.(*matchState)
	if !ok {
		return state
	}

	if current.matchID == "" {
		if id, ok := ctx.Value(runtime.RUNTIME_CTX_MATCH_ID).(string); ok {
			current.matchID = id
		}
	}

	for _, presence := range presences {
		if seated, alreadyIn := current.players[presence.GetUserId()]; alreadyIn {
			// Same player on a new socket — a reload, or a reconnection. They
			// keep their side and their acknowledged input; only the socket to
			// send to changes.
			seated.presence = presence
			logger.Info("Player %s rejoined on a new socket", presence.GetUsername())
			continue
		}
		current.players[presence.GetUserId()] = &player{
			presence: presence,
			side:     current.freeSide(),
		}
		logger.Info("Player %s joined the match", presence.GetUsername())
		current.rememberFor(ctx, logger, nk, presence.GetUserId())
	}

	current.rebuildTargets()

	// The countdown opens as soon as both seats are taken, and only from
	// waiting: a rejoin mid-match must not restart the match.
	if len(current.players) == Capacity && current.sim.Phase == pong.PhaseWaiting {
		current.sim = pong.StartCountdown(current.sim)
		logger.Info("Both players present, starting the countdown")
		// Out of the waiting list the moment it stops waiting.
		current.relabel(logger, dispatcher, StatePlaying)
	}

	return current
}

// freeSide returns whichever end of the field nobody is defending yet.
func (s *matchState) freeSide() string {
	for _, participant := range s.players {
		if participant.side == pong.SideLeft {
			return pong.SideRight
		}
	}
	return pong.SideLeft
}

func (m *PongMatch) MatchLeave(
	_ context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	_ runtime.MatchDispatcher,
	_ int64,
	state interface{},
	presences []runtime.Presence,
) interface{} {
	current, ok := state.(*matchState)
	if !ok {
		return state
	}

	for _, presence := range presences {
		seated, stillIn := current.players[presence.GetUserId()]
		// Only the socket actually holding the seat can vacate it. A player who
		// opened a second one — a reload, or a client that mounts twice — would
		// otherwise have their live session evicted by the departure of the one
		// they already replaced, and would sit there receiving nothing.
		if !stillIn || seated.presence.GetSessionId() != presence.GetSessionId() {
			logger.Info("Ignored a leave from a socket that no longer holds a seat")
			continue
		}
		delete(current.players, presence.GetUserId())
		logger.Info("Player %s left the match", presence.GetUsername())
	}

	current.rebuildTargets()

	// Deliberately not closing here. The match is given time to be rejoined,
	// and the loop closes it if nobody comes back.
	if len(current.players) == 0 {
		logger.Info("Match is empty, holding it open for a reconnection")
	}

	return current
}

func (m *PongMatch) MatchLoop(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	dispatcher runtime.MatchDispatcher,
	tick int64,
	state interface{},
	messages []runtime.MatchData,
) interface{} {
	current, ok := state.(*matchState)
	if !ok {
		return state
	}

	if len(current.players) == 0 {
		if current.emptySince < 0 {
			current.emptySince = tick
		}
		if tick-current.emptySince > ReconnectGraceTicks {
			logger.Info("Nobody came back, closing the match")
			return nil
		}
	} else {
		current.emptySince = -1
	}

	current.applyInputs(logger, messages)
	before := current.sim.Phase
	current.sim = pong.Step(current.sim, current.inputs())

	if current.sim.Phase == pong.PhaseFinished && before != pong.PhaseFinished && !current.recorded {
		current.recorded = true
		current.finishedAt = tick
		stats.RecordMatch(ctx, logger, nk, PongName, current.outcomes())

		// Taken out of the listings straight away, so nobody looking for a game
		// is sent to a table that has already been won.
		current.relabel(logger, dispatcher, StateOver)
		// And out of everyone's resume list: a finished game is not one to
		// come back to.
		current.forgetAll(ctx, logger, nk)
	}

	// Long enough to read the score, then gone. A finished match left running
	// keeps ticking for a game nobody can play.
	if current.finishedAt >= 0 && tick-current.finishedAt > FinishedLingerTicks {
		logger.Info("Finished match has been read, closing it")
		return nil
	}

	if err := current.broadcastSnapshot(dispatcher, tick); err != nil {
		logger.Error("Failed to broadcast snapshot: %v", err)
	}

	return current
}

func (m *PongMatch) MatchTerminate(
	_ context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	_ runtime.MatchDispatcher,
	_ int64,
	state interface{},
	graceSeconds int,
) interface{} {
	logger.Info("Match terminating, %d seconds of grace", graceSeconds)
	return state
}

func (m *PongMatch) MatchSignal(
	_ context.Context,
	_ runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	_ runtime.MatchDispatcher,
	_ int64,
	state interface{},
	_ string,
) (interface{}, string) {
	return state, ""
}

// applyInputs folds this tick's client messages into the state.
//
// Anything unparseable or out of order is dropped rather than trusted. Inputs
// arrive over an unreliable path and from a client we do not control, so a
// stale or forged sequence number must not be able to rewind a player's
// acknowledged position.
func (s *matchState) applyInputs(logger runtime.Logger, messages []runtime.MatchData) {
	for _, message := range messages {
		if message.GetOpCode() != int64(matchv1.OpCode_OP_CODE_PLAYER_INPUT) {
			continue
		}

		participant, known := s.players[message.GetUserId()]
		if !known {
			continue
		}

		var input matchv1.PlayerInput
		if err := proto.Unmarshal(message.GetData(), &input); err != nil {
			logger.Warn("Discarded a malformed input from %s: %v", message.GetUsername(), err)
			continue
		}

		if input.GetSeq() <= participant.lastProcessedSeq {
			continue
		}

		participant.lastProcessedSeq = input.GetSeq()
		participant.up = input.GetUp()
		participant.down = input.GetDown()
	}
}

// activeRecord is what a player is told about a match they can return to.
//
// The password is included because it is the player's own record, readable by
// nobody else, and they were admitted with it once already. Without it a locked
// lobby could be left but never rejoined.
type activeRecord struct {
	MatchID  string `json:"matchId"`
	Game     string `json:"game"`
	Host     string `json:"host"`
	Password string `json:"password"`
}

// rememberFor records that this player belongs to this match.
func (s *matchState) rememberFor(
	ctx context.Context,
	logger runtime.Logger,
	nk runtime.NakamaModule,
	userID string,
) {
	value, err := json.Marshal(activeRecord{
		MatchID:  s.matchID,
		Game:     s.label.Game,
		Host:     s.label.Host,
		Password: s.password,
	})
	if err != nil {
		return
	}
	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      ActiveCollection,
		Key:             s.matchID,
		UserID:          userID,
		Value:           string(value),
		PermissionRead:  1,
		PermissionWrite: 0,
	}}); err != nil {
		logger.Error("Failed to remember a match for a player: %v", err)
	}
}

// forgetAll drops this match from every seated player's resume list.
func (s *matchState) forgetAll(
	ctx context.Context,
	logger runtime.Logger,
	nk runtime.NakamaModule,
) {
	deletes := make([]*runtime.StorageDelete, 0, len(s.players))
	for userID := range s.players {
		deletes = append(deletes, &runtime.StorageDelete{
			Collection: ActiveCollection,
			Key:        s.matchID,
			UserID:     userID,
		})
	}
	if len(deletes) == 0 {
		return
	}
	if err := nk.StorageDelete(ctx, deletes); err != nil {
		logger.Error("Failed to clear a finished match from resume lists: %v", err)
	}
}

// relabel republishes what the lobby advertises after its state changed.
func (s *matchState) relabel(
	logger runtime.Logger,
	dispatcher runtime.MatchDispatcher,
	state string,
) {
	s.label.State = state
	if err := dispatcher.MatchLabelUpdate(s.label.encode()); err != nil {
		logger.Error("Failed to update the lobby label: %v", err)
	}
}

// outcomes turns the finished simulation into one result per player.
func (s *matchState) outcomes() []stats.Outcome {
	results := make([]stats.Outcome, 0, len(s.players))
	for _, participant := range s.players {
		own, other := s.sim.Score.Left, s.sim.Score.Right
		if participant.side == pong.SideRight {
			own, other = other, own
		}
		results = append(results, stats.Outcome{
			UserID:        participant.presence.GetUserId(),
			Username:      participant.presence.GetUsername(),
			Won:           s.sim.Winner == participant.side,
			PointsFor:     own,
			PointsAgainst: other,
		})
	}
	return results
}

// inputs collects what each side is pressing for this tick.
func (s *matchState) inputs() pong.Inputs {
	var collected pong.Inputs
	for _, participant := range s.players {
		pressed := pong.PaddleInput{Up: participant.up, Down: participant.down}
		if participant.side == pong.SideLeft {
			collected.Left = pressed
		} else {
			collected.Right = pressed
		}
	}
	return collected
}

func phaseToProto(phase string) matchv1.Phase {
	switch phase {
	case pong.PhaseWaiting:
		return matchv1.Phase_PHASE_WAITING
	case pong.PhaseCountdown:
		return matchv1.Phase_PHASE_COUNTDOWN
	case pong.PhasePlaying:
		return matchv1.Phase_PHASE_PLAYING
	case pong.PhasePointScored:
		return matchv1.Phase_PHASE_POINT_SCORED
	case pong.PhaseFinished:
		return matchv1.Phase_PHASE_FINISHED
	default:
		return matchv1.Phase_PHASE_UNSPECIFIED
	}
}

func sideToProto(side string) matchv1.Side {
	switch side {
	case pong.SideLeft:
		return matchv1.Side_SIDE_LEFT
	case pong.SideRight:
		return matchv1.Side_SIDE_RIGHT
	default:
		return matchv1.Side_SIDE_UNSPECIFIED
	}
}

// broadcastSnapshot sends the authoritative state to everyone in the match.
func (s *matchState) broadcastSnapshot(dispatcher runtime.MatchDispatcher, tick int64) error {
	if len(s.broadcastTargets) == 0 {
		return nil
	}

	snapshot := &matchv1.Snapshot{
		Tick:    uint32(tick),
		Players: make([]*matchv1.PlayerState, 0, len(s.players)),
		Game: &matchv1.GameState{
			Phase:        phaseToProto(s.sim.Phase),
			PhaseTicks:   uint32(s.sim.PhaseTicks),
			LeftPaddleY:  s.sim.Left.Y,
			RightPaddleY: s.sim.Right.Y,
			Ball: &matchv1.Ball{
				X:     s.sim.Ball.X,
				Y:     s.sim.Ball.Y,
				Vx:    s.sim.Ball.VX,
				Vy:    s.sim.Ball.VY,
				Speed: s.sim.Ball.Speed,
			},
			ScoreLeft:  uint32(s.sim.Score.Left),
			ScoreRight: uint32(s.sim.Score.Right),
			Winner:     sideToProto(s.sim.Winner),
		},
	}

	for _, participant := range s.players {
		snapshot.Players = append(snapshot.Players, &matchv1.PlayerState{
			UserId:           participant.presence.GetUserId(),
			Username:         participant.presence.GetUsername(),
			LastProcessedSeq: participant.lastProcessedSeq,
			Up:               participant.up,
			Down:             participant.down,
			Side:             sideToProto(participant.side),
		})
	}

	payload, err := proto.Marshal(snapshot)
	if err != nil {
		return err
	}

	// Unreliable: a snapshot is a complete picture of the present, so a dropped
	// one is replaced by the next tick 33 ms later. Retransmitting it would
	// deliver stale state late, which is worse than not delivering it.
	return dispatcher.BroadcastMessage(
		int64(matchv1.OpCode_OP_CODE_SNAPSHOT),
		payload,
		nil,
		nil,
		false,
	)
}

// rebuildTargets refreshes the cached presence list after a membership change.
func (s *matchState) rebuildTargets() {
	targets := make([]runtime.Presence, 0, len(s.players))
	for _, participant := range s.players {
		targets = append(targets, participant.presence)
	}
	s.broadcastTargets = targets
}
