package match

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/heroiclabs/nakama-common/runtime"
	"littlegames.local/nakama/hockey"
	"littlegames.local/nakama/stats"
	"math"
)

const HockeyName = "hockey"

type hockeyPlayer struct {
	id, name   string
	presence   runtime.Presence
	input      hockey.Input
	seq, shots int
	lastInput  int64
}
type hockeyMatchState struct {
	sim                     hockey.State
	players                 [2]*hockeyPlayer
	label                   Label
	password, matchID       string
	absentSince, finishedAt int64
	recorded                bool
}
type HockeyMatch struct{}

var _ runtime.Match = (*HockeyMatch)(nil)

func (m *HockeyMatch) MatchInit(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	password, _ := params["password"].(string)
	host, _ := params["host"].(string)
	locked := "no"
	if password != "" {
		locked = "yes"
	}
	s := &hockeyMatchState{sim: hockey.New(), password: password, label: Label{Game: HockeyName, Host: host, Locked: locked, State: StateWaiting}, absentSince: -1, finishedAt: -1}
	return s, 60, s.label.encode()
}
func (s *hockeyMatchState) seat(id string) int {
	for i, p := range s.players {
		if p != nil && p.id == id {
			return i
		}
	}
	return -1
}
func (s *hockeyMatchState) both() bool {
	return s.players[0] != nil && s.players[1] != nil && s.players[0].presence != nil && s.players[1].presence != nil
}
func (m *HockeyMatch) MatchJoinAttempt(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, p runtime.Presence, metadata map[string]string) (interface{}, bool, string) {
	s := state.(*hockeyMatchState)
	if s.seat(p.GetUserId()) >= 0 {
		return s, true, ""
	}
	if s.sim.Phase != "waiting" || s.players[0] != nil && s.players[1] != nil {
		return s, false, "This rink is full."
	}
	if s.password != "" && metadata["password"] != s.password {
		return s, false, "That lobby needs the right password."
	}
	return s, true, ""
}
func (m *HockeyMatch) MatchJoin(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, d runtime.MatchDispatcher, _ int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*hockeyMatchState)
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
		s.players[seat] = &hockeyPlayer{id: p.GetUserId(), name: p.GetUsername(), presence: p}
		if s.sim.Phase != "finished" {
			rememberMatchFor(ctx, logger, nk, p.GetUserId(), s.matchID, s.label, s.password)
		}
	}
	if s.both() {
		s.absentSince = -1
		if s.sim.Phase == "waiting" {
			s.sim = hockey.Start(s.sim)
		}
		if s.sim.Phase != "finished" {
			s.label.State = StatePlaying
		}
		_ = d.MatchLabelUpdate(s.label.encode())
	}
	s.broadcast(d)
	return s
}
func (m *HockeyMatch) MatchLeave(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	s := state.(*hockeyMatchState)
	for _, p := range presences {
		seat := s.seat(p.GetUserId())
		if seat >= 0 && s.players[seat].presence != nil && s.players[seat].presence.GetSessionId() == p.GetSessionId() {
			s.players[seat].presence = nil
			s.players[seat].input = hockey.Input{}
		}
	}
	s.absentSince = tick
	return s
}
func (s *hockeyMatchState) broadcast(d runtime.MatchDispatcher) {
	names := []string{"Home skater", "Away skater"}
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
		payload, _ := json.Marshal(struct {
			Version   int          `json:"version"`
			State     hockey.State `json:"state"`
			Seat      int          `json:"seat"`
			Names     []string     `json:"names"`
			Connected []bool       `json:"connected"`
		}{1, s.sim, i, names, connected})
		_ = d.BroadcastMessage(3, payload, []runtime.Presence{p.presence}, nil, false)
	}
}
func (m *HockeyMatch) MatchLoop(ctx context.Context, logger runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, d runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) interface{} {
	s := state.(*hockeyMatchState)
	for _, message := range messages {
		seat := s.seat(message.GetUserId())
		if seat < 0 || s.players[seat].presence == nil || s.players[seat].presence.GetSessionId() != message.GetSessionId() || message.GetOpCode() != 1 || len(message.GetData()) > 512 {
			continue
		}
		var in struct {
			Version int     `json:"version"`
			Seq     int     `json:"seq"`
			X       float64 `json:"x"`
			Y       float64 `json:"y"`
			Shots   int     `json:"shots"`
		}
		if json.Unmarshal(message.GetData(), &in) != nil || in.Version != 1 || in.Seq <= s.players[seat].seq || math.IsNaN(in.X) || math.IsNaN(in.Y) || math.IsInf(in.X, 0) || math.IsInf(in.Y, 0) || in.Shots < 0 {
			continue
		}
		p := s.players[seat]
		p.seq = in.Seq
		p.input = hockey.Input{X: in.X, Y: in.Y, Shoot: p.input.Shoot || in.Shots > p.shots}
		p.shots = max(p.shots, in.Shots)
		p.lastInput = tick
	}
	if s.both() {
		inputs := [2]hockey.Input{}
		for i, p := range s.players {
			if tick-p.lastInput < 30 {
				inputs[i] = p.input
			}
			p.input.Shoot = false
		}
		s.sim = hockey.Step(s.sim, inputs)
	} else {
		if s.absentSince < 0 {
			s.absentSince = tick
		}
		if tick-s.absentSince > 3600 {
			present := -1
			for i, p := range s.players {
				if p != nil && p.presence != nil {
					present = i
				}
			}
			if present < 0 || s.sim.Phase == "waiting" && tick-s.absentSince > 36000 {
				return nil
			}
			if s.sim.Phase != "waiting" && s.sim.Phase != "finished" {
				s.sim.Phase = "finished"
				s.sim.Winner = present
				s.sim.Scores[present] = 5
			}
		}
	}
	if s.sim.Phase == "finished" && !s.recorded {
		s.recorded = true
		s.finishedAt = tick
		s.label.State = StateOver
		_ = d.MatchLabelUpdate(s.label.encode())
		ids := []string{}
		outcomes := []stats.Outcome{}
		for i, p := range s.players {
			if p != nil {
				ids = append(ids, p.id)
				outcomes = append(outcomes, stats.Outcome{UserID: p.id, Username: p.name, Won: s.sim.Winner == i, PointsFor: s.sim.Scores[i], PointsAgainst: s.sim.Scores[1-i]})
			}
		}
		stats.RecordMatch(ctx, logger, nk, HockeyName, outcomes)
		forgetMatchFor(ctx, logger, nk, s.matchID, ids)
	}
	if s.finishedAt >= 0 && tick-s.finishedAt > 3600 {
		return nil
	}
	if tick%2 == 0 {
		s.broadcast(d)
	}
	return s
}
func (m *HockeyMatch) MatchTerminate(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, _ int) interface{} {
	return state
}
func (m *HockeyMatch) MatchSignal(_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, _ runtime.MatchDispatcher, _ int64, state interface{}, data string) (interface{}, string) {
	s := state.(*hockeyMatchState)
	roster := map[string]string{}
	for _, p := range s.players {
		if p != nil && p.presence != nil {
			roster[p.id] = p.name
		}
	}
	if answer, handled := voiceSignal(data, s.matchID, roster); handled {
		return s, answer
	}
	if s.sim.Phase != "waiting" || s.players[0] != nil && s.players[1] != nil || s.password != "" && data != s.password {
		return s, SignalRefused
	}
	return s, SignalOK
}
