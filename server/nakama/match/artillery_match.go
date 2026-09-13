package match

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/heroiclabs/nakama-common/runtime"
	"littlegames.local/nakama/artillery"
	"littlegames.local/nakama/stats"
)

const ArtilleryName = "artillery"
const artilleryRate = 10

type artilleryPlayer struct {
	id, name string
	presence runtime.Presence
}
type artilleryMatchState struct {
	sim                                             artillery.State
	players                                         [2]*artilleryPlayer
	password, matchID                               string
	label                                           Label
	deadline, resolveUntil, absentSince, finishedAt int64
	recorded                                        bool
}
type ArtilleryMatch struct{}

var _ runtime.Match = (*ArtilleryMatch)(nil)

func (m *ArtilleryMatch) MatchInit(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	password, _ := params["password"].(string)
	host, _ := params["host"].(string)
	locked := "no"
	if password != "" {
		locked = "yes"
	}
	s := &artilleryMatchState{sim: artillery.New(artillery.DefaultOptions), password: password, label: Label{Game: ArtilleryName, State: StateWaiting, Locked: locked, Host: host}, absentSince: -1, finishedAt: -1}
	return s, artilleryRate, s.label.encode()
}
func (s *artilleryMatchState) seat(id string) int {
	for i, p := range s.players {
		if p != nil && p.id == id {
			return i
		}
	}
	return -1
}
func (s *artilleryMatchState) both() bool {
	return s.players[0] != nil && s.players[1] != nil && s.players[0].presence != nil && s.players[1].presence != nil
}
func (m *ArtilleryMatch) MatchJoinAttempt(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, p runtime.Presence, metadata map[string]string) (interface{}, bool, string) {
	s := state.(*artilleryMatchState)
	if s.seat(p.GetUserId()) >= 0 {
		return s, true, ""
	}
	if s.sim.Phase != "setup" || s.players[0] != nil && s.players[1] != nil {
		return s, false, "This duel is already full."
	}
	if s.password != "" && metadata["password"] != s.password {
		return s, false, "That lobby needs the right password."
	}
	return s, true, ""
}
func (m *ArtilleryMatch) MatchJoin(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, d runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*artilleryMatchState)
	if s.matchID == "" {
		s.matchID, _ = ctx.Value(runtime.RUNTIME_CTX_MATCH_ID).(string)
	}
	for _, p := range presences {
		seat := s.seat(p.GetUserId())
		if seat < 0 {
			for i, existing := range s.players {
				if existing == nil {
					seat = i
					break
				}
			}
		}
		if seat < 0 {
			continue
		}
		s.players[seat] = &artilleryPlayer{id: p.GetUserId(), name: p.GetUsername(), presence: p}
		rememberMatchFor(ctx, logger, nk, p.GetUserId(), s.matchID, s.label, s.password)
	}
	if s.both() {
		s.absentSince = -1
		s.deadline = tick + int64(s.sim.Options.TurnSeconds*artilleryRate)
		s.label.State = StatePlaying
		_ = d.MatchLabelUpdate(s.label.encode())
	}
	s.broadcast(d, tick)
	return s
}
func (m *ArtilleryMatch) MatchLeave(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*artilleryMatchState)
	for _, p := range presences {
		seat := s.seat(p.GetUserId())
		if seat >= 0 && s.players[seat].presence != nil && s.players[seat].presence.GetSessionId() == p.GetSessionId() {
			s.players[seat].presence = nil
		}
	}
	if !s.both() {
		s.absentSince = tick
	}
	return s
}
func (s *artilleryMatchState) broadcast(d runtime.MatchDispatcher, tick int64) {
	names := []string{"Commander One", "Waiting for a rival"}
	connected := []bool{false, false}
	for i, p := range s.players {
		if p != nil {
			names[i] = p.name
			connected[i] = p.presence != nil
		}
	}
	for i, p := range s.players {
		if p == nil || p.presence == nil {
			continue
		}
		seconds := max(0, int((s.deadline-tick+9)/10))
		if !s.both() {
			seconds = s.sim.Options.TurnSeconds
		}
		payload, _ := json.Marshal(struct {
			Version          int             `json:"version"`
			State            artillery.State `json:"state"`
			Seat             int             `json:"seat"`
			Names            []string        `json:"names"`
			Connected        []bool          `json:"connected"`
			RemainingSeconds int             `json:"remainingSeconds"`
		}{1, s.sim, i, names, connected, seconds})
		_ = d.BroadcastMessage(3, payload, []runtime.Presence{p.presence}, nil, true)
	}
}
func (m *ArtilleryMatch) MatchLoop(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, d runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) interface{} {
	s := state.(*artilleryMatchState)
	for _, message := range messages {
		seat := s.seat(message.GetUserId())
		if seat < 0 || s.players[seat].presence == nil || s.players[seat].presence.GetSessionId() != message.GetSessionId() || message.GetOpCode() != 1 || len(message.GetData()) > 2048 {
			continue
		}
		var request struct {
			Version int              `json:"version"`
			Action  artillery.Action `json:"action"`
		}
		reason := ""
		if json.Unmarshal(message.GetData(), &request) != nil || request.Version != 1 {
			reason = "Unsupported command."
		} else if request.Action.Revision != s.sim.Revision {
			reason = "The game changed. Please try your action again."
		} else if tick < s.resolveUntil {
			reason = "Wait for the shell to land."
		} else if !s.both() && request.Action.Type != "configure" && request.Action.Type != "ready" {
			reason = "Waiting for your opponent to reconnect."
		} else {
			next, err := artillery.Act(s.sim, seat, request.Action)
			if err != nil {
				reason = err.Error()
			} else {
				s.sim = next
				if request.Action.Type == "fire" {
					s.resolveUntil = tick + 20
				}
				s.deadline = max(tick, s.resolveUntil) + int64(s.sim.Options.TurnSeconds*artilleryRate)
			}
		}
		if reason != "" {
			payload, _ := json.Marshal(map[string]string{"reason": reason})
			_ = d.BroadcastMessage(4, payload, []runtime.Presence{message}, nil, true)
		}
	}
	if s.both() && s.sim.Phase == "playing" && tick >= s.deadline && tick >= s.resolveUntil {
		s.sim, _ = artillery.Act(s.sim, s.sim.Turn, artillery.Action{Type: "pass"})
		s.deadline = tick + int64(s.sim.Options.TurnSeconds*artilleryRate)
	}
	if !s.both() {
		if s.absentSince < 0 {
			s.absentSince = tick
		}
		if tick-s.absentSince > 600 {
			present := -1
			for i, p := range s.players {
				if p != nil && p.presence != nil {
					present = i
				}
			}
			if present < 0 || s.sim.Phase == "setup" && tick-s.absentSince > 6000 {
				ids := []string{}
				for _, p := range s.players {
					if p != nil {
						ids = append(ids, p.id)
					}
				}
				forgetMatchFor(ctx, logger, nk, s.matchID, ids)
				return nil
			}
			if s.sim.Phase != "finished" && s.sim.Phase != "setup" {
				s.sim.Phase = "finished"
				s.sim.Winner = present
				s.sim.Scores[present] = (s.sim.Options.BestOf + 1) / 2
				s.sim.Revision++
			}
		}
	}
	if s.sim.Phase == "finished" && !s.recorded {
		s.recorded = true
		s.finishedAt = tick
		s.label.State = StateOver
		_ = d.MatchLabelUpdate(s.label.encode())
		outcomes := []stats.Outcome{}
		ids := []string{}
		for i, p := range s.players {
			if p != nil {
				ids = append(ids, p.id)
				outcomes = append(outcomes, stats.Outcome{UserID: p.id, Username: p.name, Won: s.sim.Winner == i, PointsFor: s.sim.Scores[i], PointsAgainst: s.sim.Scores[1-i]})
			}
		}
		stats.RecordMatch(ctx, logger, nk, ArtilleryName, outcomes)
		forgetMatchFor(ctx, logger, nk, s.matchID, ids)
	}
	if s.finishedAt >= 0 && tick-s.finishedAt > 600 {
		return nil
	}
	if len(messages) > 0 || tick%10 == 0 {
		s.broadcast(d, tick)
	}
	return s
}
func (m *ArtilleryMatch) MatchTerminate(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, _ int) interface{} {
	return state
}
func (m *ArtilleryMatch) MatchSignal(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, data string) (interface{}, string) {
	s := state.(*artilleryMatchState)
	if s.sim.Phase != "setup" || s.players[0] != nil && s.players[1] != nil || s.password != "" && data != s.password {
		return s, SignalRefused
	}
	return s, SignalOK
}
