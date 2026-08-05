// Package stats records what happened in a finished match.
package stats

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/heroiclabs/nakama-common/runtime"
)

// Collection holds one record per player, keyed by game id.
//
// Readable by its owner, writable by nobody: a player may see their own record,
// and only the server may change it. Letting a client write here would make
// every number in it a claim rather than a fact.
const Collection = "stats"

const (
	permissionOwnerRead = 1
	permissionNoWrite   = 0
)

// LeaderboardFor names the weekly board a game's wins are written to.
//
// One per game rather than one overall: a win at Pong says nothing about who is
// good at anything else, and a single board would rank them against each other.
func LeaderboardFor(gameID string) string {
	return gameID + "_wins_weekly"
}

// Nakama's cron for "every Monday at midnight UTC". Weekly, as the brief asks.
const leaderboardResetSchedule = "0 0 * * 1"

// Notification code for a match ending, so a client can tell them apart.
const NotificationMatchFinished = 1

// Record is what a player has done in one game.
type Record struct {
	Played int `json:"played"`
	Won    int `json:"won"`
	Lost   int `json:"lost"`
	// PointsFor and PointsAgainst let a ratio be shown without another round
	// trip, and survive a change to how a match is scored.
	PointsFor     int `json:"pointsFor"`
	PointsAgainst int `json:"pointsAgainst"`
}

// EnsureLeaderboard creates the board if it is not there yet.
//
// Safe to call on every start: Nakama treats a second create of the same id as
// a no-op rather than an error, which is what makes this idempotent.
func EnsureLeaderboard(
	ctx context.Context,
	logger runtime.Logger,
	nk runtime.NakamaModule,
	gameID string,
) error {
	id := LeaderboardFor(gameID)
	// Descending, incrementing: a player's score is their running number of
	// wins this week, so each win adds one rather than replacing the total.
	if err := nk.LeaderboardCreate(
		ctx, id, true, "desc", "incr", leaderboardResetSchedule, nil, true,
	); err != nil {
		return fmt.Errorf("create leaderboard %q: %w", id, err)
	}
	logger.Info("Leaderboard %q ready", id)
	return nil
}

// Outcome is one player's result in a finished match.
type Outcome struct {
	UserID        string
	Username      string
	Won           bool
	PointsFor     int
	PointsAgainst int
}

// RecordMatch writes both players' results.
//
// Everything here runs server-side on purpose. A score the client reported
// would be a score the client could choose.
func RecordMatch(
	ctx context.Context,
	logger runtime.Logger,
	nk runtime.NakamaModule,
	gameID string,
	outcomes []Outcome,
) {
	for _, outcome := range outcomes {
		if err := updateRecord(ctx, nk, gameID, outcome); err != nil {
			logger.Error("Failed to update stats for %s: %v", outcome.Username, err)
		}

		if outcome.Won {
			if _, err := nk.LeaderboardRecordWrite(
				ctx, LeaderboardFor(gameID), outcome.UserID, outcome.Username, 1, 0, nil, nil,
			); err != nil {
				logger.Error("Failed to write a leaderboard record for %s: %v", outcome.Username, err)
			}
		}

		// Sent whether the player is connected or not: someone whose opponent
		// left, or who closed the tab on the last point, still wants to know
		// how it ended.
		content := map[string]interface{}{
			"gameId":        gameID,
			"won":           outcome.Won,
			"pointsFor":     outcome.PointsFor,
			"pointsAgainst": outcome.PointsAgainst,
		}
		subject := "You lost a match"
		if outcome.Won {
			subject = "You won a match"
		}
		if err := nk.NotificationSend(
			ctx, outcome.UserID, subject, content, NotificationMatchFinished, "", true,
		); err != nil {
			logger.Error("Failed to notify %s: %v", outcome.Username, err)
		}
	}
}

// updateRecord folds one result into a player's running totals.
func updateRecord(
	ctx context.Context,
	nk runtime.NakamaModule,
	gameID string,
	outcome Outcome,
) error {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: Collection,
		Key:        gameID,
		UserID:     outcome.UserID,
	}})
	if err != nil {
		return fmt.Errorf("read: %w", err)
	}

	var record Record
	if len(objects) > 0 {
		// A record we cannot read is treated as absent rather than fatal: losing
		// a history is better than refusing to record anything ever again.
		_ = json.Unmarshal([]byte(objects[0].GetValue()), &record)
	}

	record.Played++
	if outcome.Won {
		record.Won++
	} else {
		record.Lost++
	}
	record.PointsFor += outcome.PointsFor
	record.PointsAgainst += outcome.PointsAgainst

	value, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("encode: %w", err)
	}

	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      Collection,
		Key:             gameID,
		UserID:          outcome.UserID,
		Value:           string(value),
		PermissionRead:  permissionOwnerRead,
		PermissionWrite: permissionNoWrite,
	}}); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	return nil
}
