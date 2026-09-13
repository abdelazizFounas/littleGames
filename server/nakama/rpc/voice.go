package rpc

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/heroiclabs/nakama-common/runtime"
	"littlegames.local/nakama/match"
)

func voiceRoom(ctx context.Context, _ runtime.Logger, _ *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	userID, _ := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if userID == "" {
		return "", runtime.NewError("Sign in to use match voice.", 16)
	}
	var request struct {
		MatchID string `json:"matchId"`
		Action  string `json:"action"`
		PeerID  string `json:"peerId"`
	}
	if len(payload) > 1024 || json.Unmarshal([]byte(payload), &request) != nil || len(request.MatchID) > 128 || request.MatchID == "" {
		return "", runtime.NewError("Invalid voice room.", 3)
	}
	body := match.VoicePayload(match.VoiceRequest{Voice: true, UserID: userID, Action: request.Action, PeerID: request.PeerID})
	response, err := nk.MatchSignal(ctx, request.MatchID, body)
	if err != nil {
		return "", runtime.NewError("The match is no longer available.", 5)
	}
	if response == match.SignalRefused || response == match.SignalOK {
		return "", runtime.NewError("Voice is unavailable in this match.", 9)
	}
	return response, nil
}
