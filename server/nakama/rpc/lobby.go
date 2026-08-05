package rpc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/heroiclabs/nakama-common/runtime"
	"littlegames.local/nakama/match"
)

const (
	// AutoLobbyID finds an open unlocked lobby, or opens one.
	AutoLobbyID = "lobby.auto"
	// CreateLobbyID opens a lobby, with or without a password.
	CreateLobbyID = "lobby.create"
	// ListLobbiesID lists the lobbies still waiting for an opponent.
	ListLobbiesID = "lobby.list"
)

const lobbyListLimit = 50

// Only lobbies still waiting are worth listing. A match already under way
// cannot be joined, and one that is over is no longer a lobby at all.
const waitingUnlockedQuery = "+label.game:pong +label.state:waiting +label.locked:no"
const waitingQuery = "+label.game:pong +label.state:waiting"

type createLobbyRequest struct {
	// Empty means an open lobby anyone may walk into.
	Password string `json:"password"`
}

type lobbyResponse struct {
	MatchID string `json:"matchId"`
}

type lobbySummary struct {
	MatchID string `json:"matchId"`
	Host    string `json:"host"`
	Locked  bool   `json:"locked"`
	Players int    `json:"players"`
}

type listLobbiesResponse struct {
	Lobbies []lobbySummary `json:"lobbies"`
}

func callerName(ctx context.Context) string {
	username, _ := ctx.Value(runtime.RUNTIME_CTX_USERNAME).(string)
	if username == "" {
		return "someone"
	}
	return username
}

func openLobby(
	ctx context.Context,
	nk runtime.NakamaModule,
	host string,
	password string,
) (string, error) {
	return nk.MatchCreate(ctx, match.PongName, map[string]interface{}{
		"host":     host,
		"password": password,
	})
}

func encodeLobby(matchID string) (string, error) {
	response, err := json.Marshal(lobbyResponse{MatchID: matchID})
	if err != nil {
		return "", runtime.NewError("could not encode the response", codeInternal)
	}
	return string(response), nil
}

// autoLobby drops the caller into the first open unlocked lobby, or opens one.
//
// Locked lobbies are skipped rather than offered and refused: someone who asked
// for a quick game did not ask to be handed a door they have no key to.
func autoLobby(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	_ string,
) (string, error) {
	matches, err := nk.MatchList(ctx, findMatchCandidates, true, "", nil, nil, waitingUnlockedQuery)
	if err != nil {
		logger.Error("Failed to list lobbies: %v", err)
		return "", runtime.NewError("could not look for a game", codeInternal)
	}

	if len(matches) > 0 {
		return encodeLobby(matches[0].GetMatchId())
	}

	matchID, err := openLobby(ctx, nk, callerName(ctx), "")
	if err != nil {
		logger.Error("Failed to open a lobby: %v", err)
		return "", runtime.NewError("could not open a lobby", codeInternal)
	}
	return encodeLobby(matchID)
}

// createLobby always opens a new one, locked or not.
func createLobby(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	payload string,
) (string, error) {
	var request createLobbyRequest
	if payload != "" {
		if err := json.Unmarshal([]byte(payload), &request); err != nil {
			return "", runtime.NewError("that request is not readable", codeInvalidArgument)
		}
	}

	matchID, err := openLobby(ctx, nk, callerName(ctx), request.Password)
	if err != nil {
		logger.Error("Failed to open a lobby: %v", err)
		return "", runtime.NewError("could not open a lobby", codeInternal)
	}
	return encodeLobby(matchID)
}

// listLobbies reports the lobbies still waiting, locked ones included.
//
// A locked lobby is shown, not hidden: knowing a game is there and needing a
// password to enter is the point. What is never sent is the password itself.
func listLobbies(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	_ string,
) (string, error) {
	matches, err := nk.MatchList(ctx, lobbyListLimit, true, "", nil, nil, waitingQuery)
	if err != nil {
		logger.Error("Failed to list lobbies: %v", err)
		return "", runtime.NewError("could not list the lobbies", codeInternal)
	}

	lobbies := make([]lobbySummary, 0, len(matches))
	for _, listed := range matches {
		var label match.Label
		if err := json.Unmarshal([]byte(listed.GetLabel().GetValue()), &label); err != nil {
			// A label we cannot read describes a lobby we cannot describe.
			continue
		}
		lobbies = append(lobbies, lobbySummary{
			MatchID: listed.GetMatchId(),
			Host:    label.Host,
			Locked:  label.Locked == "yes",
			Players: int(listed.GetSize()),
		})
	}

	response, err := json.Marshal(listLobbiesResponse{Lobbies: lobbies})
	if err != nil {
		return "", runtime.NewError("could not encode the response", codeInternal)
	}
	return string(response), nil
}

func registerLobbies(initializer runtime.Initializer) error {
	for id, fn := range map[string]func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, string) (string, error){
		AutoLobbyID:   autoLobby,
		CreateLobbyID: createLobby,
		ListLobbiesID: listLobbies,
	} {
		if err := initializer.RegisterRpc(id, fn); err != nil {
			return fmt.Errorf("register %s: %w", id, err)
		}
	}
	return nil
}
