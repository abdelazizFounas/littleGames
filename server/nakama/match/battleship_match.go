package match

import (
	"context"
	"database/sql"

	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/protobuf/proto"
	"littlegames.local/nakama/battleship"
	bsv1 "littlegames.local/nakama/protocol/battleshipv1"
	"littlegames.local/nakama/stats"
)

// BattleshipName is the handler name Nakama creates these matches under.
const BattleshipName = "battleship"

// BattleshipTickRate is deliberately far below Pong's.
//
// Nothing moves between turns, so the loop exists only to pick up messages and
// answer them. Ten times a second is imperceptible to a player clicking a cell
// and costs a fraction of what thirty would.
const BattleshipTickRate = 10

type battleshipPlayer struct {
	presence runtime.Presence
	side     string
}

type battleshipState struct {
	players map[string]*battleshipPlayer
	sim     battleship.State

	label    Label
	password string
	matchID  string

	emptySince int64
	finishedAt int64
	recorded   bool
}

// BattleshipMatch is the authoritative handler for a game of Battleship.
type BattleshipMatch struct{}

var _ runtime.Match = (*BattleshipMatch)(nil)

func (m *BattleshipMatch) MatchInit(
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

	logger.Info("Battleship lobby opened by %s, locked=%s", host, locked)

	state := &battleshipState{
		players:    make(map[string]*battleshipPlayer, Capacity),
		sim:        battleship.NewState(),
		password:   password,
		label:      Label{Game: BattleshipName, State: StateWaiting, Locked: locked, Host: host},
		emptySince: -1,
		finishedAt: -1,
	}
	return state, BattleshipTickRate, state.label.encode()
}

func (m *BattleshipMatch) MatchJoinAttempt(
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
	current, ok := state.(*battleshipState)
	if !ok {
		return state, false, "invalid match state"
	}
	// Already seated: a reconnection returns to its own board rather than being
	// refused as a duplicate, and is not asked for the password again.
	if _, alreadyIn := current.players[presence.GetUserId()]; alreadyIn {
		return current, true, ""
	}
	if current.sim.Phase == battleship.PhaseFinished {
		return current, false, "that game is already over"
	}
	if len(current.players) >= Capacity {
		return current, false, "match is full"
	}
	if current.password != "" && metadata["password"] != current.password {
		return current, false, "that lobby needs the right password"
	}
	return current, true, ""
}

func (m *BattleshipMatch) MatchJoin(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	dispatcher runtime.MatchDispatcher,
	_ int64,
	state interface{},
	presences []runtime.Presence,
) interface{} {
	current, ok := state.(*battleshipState)
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
			seated.presence = presence
			continue
		}
		current.players[presence.GetUserId()] = &battleshipPlayer{
			presence: presence,
			side:     current.freeSide(),
		}
		logger.Info("Player %s joined the game", presence.GetUsername())
		current.remember(ctx, logger, nk, presence.GetUserId())
	}

	if len(current.players) == Capacity && current.sim.Phase == battleship.PhaseWaiting {
		current.sim = battleship.StartPlacement(current.sim)
		current.label.State = StatePlaying
		if err := dispatcher.MatchLabelUpdate(current.label.encode()); err != nil {
			logger.Error("Failed to take the lobby out of the waiting list: %v", err)
		}
		logger.Info("Both players present, placement begins")
	}
	return current
}

// freeSide returns whichever board nobody holds yet.
func (s *battleshipState) freeSide() string {
	for _, seated := range s.players {
		if seated.side == battleship.SideA {
			return battleship.SideB
		}
	}
	return battleship.SideA
}

// remember records that this player belongs to this game, so they can come back.
func (s *battleshipState) remember(
	ctx context.Context,
	logger runtime.Logger,
	nk runtime.NakamaModule,
	userID string,
) {
	rememberMatchFor(ctx, logger, nk, userID, s.matchID, s.label, s.password)
}

func (m *BattleshipMatch) MatchLeave(
	_ context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	_ runtime.MatchDispatcher,
	_ int64,
	state interface{},
	presences []runtime.Presence,
) interface{} {
	current, ok := state.(*battleshipState)
	if !ok {
		return state
	}
	for _, presence := range presences {
		seated, stillIn := current.players[presence.GetUserId()]
		// Only the socket holding the seat may vacate it, so a player who
		// reloaded is not evicted by the socket they already replaced.
		if !stillIn || seated.presence.GetSessionId() != presence.GetSessionId() {
			continue
		}
		delete(current.players, presence.GetUserId())
		logger.Info("Player %s left the game", presence.GetUsername())
	}
	return current
}

func (m *BattleshipMatch) MatchLoop(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	dispatcher runtime.MatchDispatcher,
	tick int64,
	state interface{},
	messages []runtime.MatchData,
) interface{} {
	current, ok := state.(*battleshipState)
	if !ok {
		return state
	}

	// Held open for a while with nobody in it, so a dropped connection is a
	// pause rather than a forfeit; closed once nobody comes back.
	if len(current.players) == 0 {
		if current.emptySince < 0 {
			current.emptySince = tick
		}
		if tick-current.emptySince > BattleshipTickRate*30 {
			return nil
		}
	} else {
		current.emptySince = -1
	}

	before := current.sim.Phase
	current.apply(logger, dispatcher, messages)

	if current.sim.Phase == battleship.PhaseFinished && before != battleship.PhaseFinished &&
		!current.recorded {
		current.recorded = true
		current.finishedAt = tick
		stats.RecordMatch(ctx, logger, nk, BattleshipName, current.outcomes())
		current.label.State = StateOver
		if err := dispatcher.MatchLabelUpdate(current.label.encode()); err != nil {
			logger.Error("Failed to take a finished game out of the listings: %v", err)
		}
		forgetMatchFor(ctx, logger, nk, current.matchID, current.playerIDs())
	}

	if current.finishedAt >= 0 && tick-current.finishedAt > BattleshipTickRate*30 {
		return nil
	}

	current.broadcast(logger, dispatcher)
	return current
}

// apply folds this tick's client messages into the game.
//
// Everything is re-checked here even though the client checks it too: a check
// the client ran is a check the client can skip.
func (s *battleshipState) apply(
	logger runtime.Logger,
	dispatcher runtime.MatchDispatcher,
	messages []runtime.MatchData,
) {
	for _, message := range messages {
		seated, known := s.players[message.GetUserId()]
		if !known {
			continue
		}

		switch message.GetOpCode() {
		case int64(bsv1.OpCode_OP_CODE_PLACE_FLEET):
			var request bsv1.PlaceFleet
			if err := proto.Unmarshal(message.GetData(), &request); err != nil {
				continue
			}
			fleet := make([]battleship.Placement, 0, len(request.GetShips()))
			for _, ship := range request.GetShips() {
				orientation := battleship.Horizontal
				if ship.GetOrientation() == bsv1.Orientation_ORIENTATION_VERTICAL {
					orientation = battleship.Vertical
				}
				fleet = append(fleet, battleship.Placement{
					Row:         int(ship.GetRow()),
					Column:      int(ship.GetColumn()),
					Orientation: orientation,
				})
			}
			next, problem := battleship.PlaceFleet(s.sim, seated.side, fleet)
			s.sim = next
			s.refuse(logger, dispatcher, seated, problem)

		case int64(bsv1.OpCode_OP_CODE_FIRE):
			var request bsv1.Fire
			if err := proto.Unmarshal(message.GetData(), &request); err != nil {
				continue
			}
			next, _, problem := battleship.Fire(s.sim, seated.side, battleship.Shot{
				Row:    int(request.GetRow()),
				Column: int(request.GetColumn()),
			})
			s.sim = next
			s.refuse(logger, dispatcher, seated, problem)
		}
	}
}

// refuse tells one player, and only that player, why their action was rejected.
func (s *battleshipState) refuse(
	logger runtime.Logger,
	dispatcher runtime.MatchDispatcher,
	seated *battleshipPlayer,
	reason string,
) {
	if reason == "" {
		return
	}
	payload, err := proto.Marshal(&bsv1.Refused{Reason: reason})
	if err != nil {
		return
	}
	if err := dispatcher.BroadcastMessage(
		int64(bsv1.OpCode_OP_CODE_REFUSED), payload,
		[]runtime.Presence{seated.presence}, nil, true,
	); err != nil {
		logger.Error("Failed to tell a player why: %v", err)
	}
}

func (s *battleshipState) playerIDs() []string {
	ids := make([]string, 0, len(s.players))
	for id := range s.players {
		ids = append(ids, id)
	}
	return ids
}

func (s *battleshipState) outcomes() []stats.Outcome {
	results := make([]stats.Outcome, 0, len(s.players))
	for _, seated := range s.players {
		own := battleship.SunkCount(s.boardOf(battleship.Opponent(seated.side)))
		against := battleship.SunkCount(s.boardOf(seated.side))
		results = append(results, stats.Outcome{
			UserID:        seated.presence.GetUserId(),
			Username:      seated.presence.GetUsername(),
			Won:           s.sim.Winner == seated.side,
			PointsFor:     own,
			PointsAgainst: against,
		})
	}
	return results
}

func (s *battleshipState) boardOf(side string) battleship.Board {
	if side == battleship.SideA {
		return s.sim.Boards.A
	}
	return s.sim.Boards.B
}

func (m *BattleshipMatch) MatchTerminate(
	_ context.Context, logger runtime.Logger, _ *sql.DB, _ runtime.NakamaModule,
	_ runtime.MatchDispatcher, _ int64, state interface{}, graceSeconds int,
) interface{} {
	logger.Info("Battleship match terminating, %d seconds of grace", graceSeconds)
	return state
}

func (m *BattleshipMatch) MatchSignal(
	_ context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule,
	_ runtime.MatchDispatcher, _ int64, state interface{}, data string,
) (interface{}, string) {
	current, ok := state.(*battleshipState)
	if !ok {
		return state, SignalRefused
	}
	if current.sim.Phase == battleship.PhaseFinished || len(current.players) >= Capacity {
		return current, SignalRefused
	}
	if current.password != "" && data != current.password {
		return current, SignalRefused
	}
	return current, SignalOK
}

func phaseToProto(phase string) bsv1.Phase {
	switch phase {
	case battleship.PhaseWaiting:
		return bsv1.Phase_PHASE_WAITING
	case battleship.PhasePlacement:
		return bsv1.Phase_PHASE_PLACEMENT
	case battleship.PhasePlaying:
		return bsv1.Phase_PHASE_PLAYING
	case battleship.PhaseFinished:
		return bsv1.Phase_PHASE_FINISHED
	default:
		return bsv1.Phase_PHASE_UNSPECIFIED
	}
}

// shotsWithResults says what each shot at a board found.
//
// Computed from the board being fired at, so the answer is the server's and not
// something a client reported about its own hits.
func shotsWithResults(board battleship.Board) []*bsv1.Shot {
	struck := make(map[int]bool, len(board.Incoming))
	for _, shot := range board.Incoming {
		struck[shot.Row*battleship.GridSize+shot.Column] = true
	}

	occupied := make(map[int]int, battleship.FleetCells)
	for index, placement := range board.Fleet {
		length := 0
		if index < len(battleship.ShipLengths) {
			length = battleship.ShipLengths[index]
		}
		for _, cell := range battleship.CellsOf(placement, length) {
			occupied[cell.Row*battleship.GridSize+cell.Column] = index
		}
	}

	sunk := make(map[int]bool, len(board.Fleet))
	for index, placement := range board.Fleet {
		length := 0
		if index < len(battleship.ShipLengths) {
			length = battleship.ShipLengths[index]
		}
		whole := true
		for _, cell := range battleship.CellsOf(placement, length) {
			if !struck[cell.Row*battleship.GridSize+cell.Column] {
				whole = false
				break
			}
		}
		sunk[index] = whole
	}

	out := make([]*bsv1.Shot, 0, len(board.Incoming))
	for _, shot := range board.Incoming {
		key := shot.Row*battleship.GridSize + shot.Column
		result := bsv1.ShotResult_SHOT_RESULT_MISS
		if ship, hit := occupied[key]; hit {
			result = bsv1.ShotResult_SHOT_RESULT_HIT
			if sunk[ship] {
				result = bsv1.ShotResult_SHOT_RESULT_SUNK
			}
		}
		out = append(out, &bsv1.Shot{
			Row: uint32(shot.Row), Column: uint32(shot.Column), Result: result,
		})
	}
	return out
}

func fleetToProto(fleet []battleship.Placement) []*bsv1.Placement {
	out := make([]*bsv1.Placement, 0, len(fleet))
	for _, placement := range fleet {
		orientation := bsv1.Orientation_ORIENTATION_HORIZONTAL
		if placement.Orientation == battleship.Vertical {
			orientation = bsv1.Orientation_ORIENTATION_VERTICAL
		}
		out = append(out, &bsv1.Placement{
			Row: uint32(placement.Row), Column: uint32(placement.Column), Orientation: orientation,
		})
	}
	return out
}

// broadcast sends every player a snapshot built for them alone.
//
// This is the one thing that must not leak. A recipient gets their own fleet in
// full, and of the opponent's waters nothing but the cells they have already
// fired at. Sending the whole board and hiding it in the interface would put
// the answer in the browser, where anyone can read it — so the answer never
// leaves the server.
func (s *battleshipState) broadcast(logger runtime.Logger, dispatcher runtime.MatchDispatcher) {
	for _, seated := range s.players {
		own := s.boardOf(seated.side)
		theirs := s.boardOf(battleship.Opponent(seated.side))

		snapshot := &bsv1.Snapshot{
			Phase:             phaseToProto(s.sim.Phase),
			YourTurn:          s.sim.Turn == seated.side && s.sim.Phase == battleship.PhasePlaying,
			YourFleet:         fleetToProto(own.Fleet),
			Incoming:          shotsWithResults(own),
			YouAreReady:       own.Ready,
			Outgoing:          shotsWithResults(theirs),
			OpponentReady:     theirs.Ready,
			OpponentPresent:   len(s.players) >= Capacity,
			YourShipsSunk:     uint32(battleship.SunkCount(own)),
			OpponentShipsSunk: uint32(battleship.SunkCount(theirs)),
			Finished:          s.sim.Phase == battleship.PhaseFinished,
			YouWon:            s.sim.Winner == seated.side,
		}

		payload, err := proto.Marshal(snapshot)
		if err != nil {
			continue
		}
		// Reliable: unlike Pong, these are not thirty pictures a second where a
		// dropped one is replaced immediately. A lost snapshot here is a board
		// that stays wrong until somebody moves.
		if err := dispatcher.BroadcastMessage(
			int64(bsv1.OpCode_OP_CODE_SNAPSHOT), payload,
			[]runtime.Presence{seated.presence}, nil, true,
		); err != nil {
			logger.Error("Failed to send a snapshot: %v", err)
		}
	}
}
