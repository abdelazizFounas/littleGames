// Package rpc holds the custom server functions clients can call by name.
package rpc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/heroiclabs/nakama-common/runtime"
	"littlegames.local/nakama/match"
)

// FindMatchID is the name clients invoke this function under.
const FindMatchID = "match.find"

// gRPC INTERNAL, which Nakama maps to HTTP 500.
const codeInternal = 13

// How many candidate matches to consider before giving up and creating one.
const findMatchCandidates = 10

type findMatchResponse struct {
	MatchID string `json:"matchId"`
}

// Register wires the custom functions into the server.
func Register(initializer runtime.Initializer) error {
	if err := initializer.RegisterRpc(FindMatchID, findMatch); err != nil {
		return fmt.Errorf("register %s: %w", FindMatchID, err)
	}
	return registerInvites(initializer)
}

// findMatch returns a match with room to spare, creating one when there is
// none.
//
// Two players who ask within the same label-index refresh window will each get
// their own match, because neither can see the other's yet. The window is set
// by match.label_update_interval_ms, tuned down in nakama.yml, and the
// race-free answer is Nakama's matchmaker, which is what random opponent
// matching will use rather than this function.
//
// Match creation is deliberately server-side. A client that could name its own
// match id could put itself into somebody else's game, and one that could
// create matches freely could exhaust the server with empty ones.
func findMatch(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	_ string,
) (string, error) {
	// Any match with a free seat is a candidate, including an empty one.
	//
	// Zero is not an oversight. A match exists from the moment it is created,
	// but nobody occupies it until that player's socket has joined, so a
	// minimum of one would make the very match we just handed to someone else
	// invisible and hand the next caller a second empty match instead.
	minPlayers := 0
	maxPlayers := match.Capacity - 1

	matches, err := nk.MatchList(
		ctx,
		findMatchCandidates,
		true, // authoritative matches only
		match.PongName,
		&minPlayers,
		&maxPlayers,
		"",
	)
	if err != nil {
		logger.Error("Failed to list matches: %v", err)
		return "", runtime.NewError("could not look for a match", codeInternal)
	}

	matchID := ""
	if len(matches) > 0 {
		// Whichever came back first. Filling an existing match beats opening
		// another one that would also sit half empty.
		matchID = matches[0].GetMatchId()
	} else {
		matchID, err = nk.MatchCreate(ctx, match.PongName, nil)
		if err != nil {
			logger.Error("Failed to create a match: %v", err)
			return "", runtime.NewError("could not create a match", codeInternal)
		}
		logger.Info("Created match %s", matchID)
	}

	response, err := json.Marshal(findMatchResponse{MatchID: matchID})
	if err != nil {
		return "", runtime.NewError("could not encode the response", codeInternal)
	}

	return string(response), nil
}
