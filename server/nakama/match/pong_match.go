// Package match holds the authoritative match handlers.
package match

import (
	"context"
	"database/sql"

	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/protobuf/proto"
	matchv1 "littlegames.local/nakama/protocol/matchv1"
)

// PongName is the handler name Nakama creates matches under.
const PongName = "pong"

// TickRate is the number of authoritative steps per second.
//
// Every part of the simulation derives its timing from this, never from a
// client's frame rate: a fixed step is what keeps two clients agreeing on the
// same outcome.
const TickRate = 30

// Capacity is how many players a match holds. Extra joiners are turned away
// rather than queued.
const Capacity = 2

// player is one participant, as the server tracks them.
type player struct {
	presence runtime.Presence

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
	_ map[string]interface{},
) (interface{}, int, string) {
	logger.Info("Pong match created at %d Hz", TickRate)

	state := &matchState{
		players:          make(map[string]*player, Capacity),
		broadcastTargets: make([]runtime.Presence, 0, Capacity),
	}

	// The label is what the matchmaker and match listings search on.
	return state, TickRate, PongName
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
	_ map[string]string,
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

	if len(current.players) >= Capacity {
		return current, false, "match is full"
	}

	return current, true, ""
}

func (m *PongMatch) MatchJoin(
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
		current.players[presence.GetUserId()] = &player{presence: presence}
		logger.Info("Player %s joined the match", presence.GetUsername())
	}

	current.rebuildTargets()
	return current
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
		delete(current.players, presence.GetUserId())
		logger.Info("Player %s left the match", presence.GetUsername())
	}

	current.rebuildTargets()

	// Returning nil tells Nakama to shut the match down. An empty match has
	// nothing left to simulate and would otherwise tick forever.
	if len(current.players) == 0 {
		logger.Info("Last player left, closing the match")
		return nil
	}

	return current
}

func (m *PongMatch) MatchLoop(
	_ context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	dispatcher runtime.MatchDispatcher,
	tick int64,
	state interface{},
	messages []runtime.MatchData,
) interface{} {
	current, ok := state.(*matchState)
	if !ok {
		return state
	}

	current.applyInputs(logger, messages)

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

// broadcastSnapshot sends the authoritative state to everyone in the match.
func (s *matchState) broadcastSnapshot(dispatcher runtime.MatchDispatcher, tick int64) error {
	if len(s.broadcastTargets) == 0 {
		return nil
	}

	snapshot := &matchv1.Snapshot{
		Tick:    uint32(tick),
		Players: make([]*matchv1.PlayerState, 0, len(s.players)),
	}

	for _, participant := range s.players {
		snapshot.Players = append(snapshot.Players, &matchv1.PlayerState{
			UserId:           participant.presence.GetUserId(),
			Username:         participant.presence.GetUsername(),
			LastProcessedSeq: participant.lastProcessedSeq,
			Up:               participant.up,
			Down:             participant.down,
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
