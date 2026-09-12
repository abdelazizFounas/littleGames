package rpc

import (
	"context"
	"encoding/json"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"littlegames.local/nakama/match"
	"testing"
	"time"
)

type inviteServer struct {
	runtime.NakamaModule
	live   *api.Match
	member bool
	stored string
}

func (s *inviteServer) MatchGet(context.Context, string) (*api.Match, error) { return s.live, nil }
func (s *inviteServer) StorageRead(_ context.Context, requests []*runtime.StorageRead) ([]*api.StorageObject, error) {
	if requests[0].Collection == match.ActiveCollection {
		if !s.member {
			return nil, nil
		}
		return []*api.StorageObject{{Value: `{"password":"private-key"}`}}, nil
	}
	return []*api.StorageObject{{Value: s.stored}}, nil
}
func (s *inviteServer) StorageWrite(_ context.Context, writes []*runtime.StorageWrite) ([]*api.StorageObjectAck, error) {
	s.stored = writes[0].Value
	return nil, nil
}
func invitationContext() context.Context {
	return context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, "player-one")
}
func liveGame(game, state string) *api.Match {
	value, _ := json.Marshal(match.Label{Game: game, State: state})
	return &api.Match{MatchId: "test-match", Label: wrapperspb.String(string(value))}
}
func TestInvitationsPreserveGameAndPrivatePassword(t *testing.T) {
	for _, game := range []string{"pong", "arena", "battleship"} {
		t.Run(game, func(t *testing.T) {
			server := &inviteServer{live: liveGame(game, match.StateWaiting), member: true}
			if _, err := createInvite(invitationContext(), nil, nil, server, `{"matchId":"test-match"}`); err != nil {
				t.Fatal(err)
			}
			response, err := resolveInvite(invitationContext(), nil, nil, server, `{"code":"abcdef"}`)
			if err != nil {
				t.Fatal(err)
			}
			var result resolveInviteResponse
			if err := json.Unmarshal([]byte(response), &result); err != nil {
				t.Fatal(err)
			}
			if result.Game != game || result.Password != "private-key" || result.MatchID != "test-match" {
				t.Fatalf("wrong destination: %+v", result)
			}
		})
	}
}
func TestUnrelatedPlayerCannotCreateAnInvite(t *testing.T) {
	server := &inviteServer{live: liveGame("arena", match.StateWaiting)}
	if _, err := createInvite(invitationContext(), nil, nil, server, `{"matchId":"test-match"}`); err == nil {
		t.Fatal("nonmember created a private invitation")
	}
}
func TestMissingMatchIsRejectedEvenWithoutAnError(t *testing.T) {
	server := &inviteServer{member: true}
	if _, err := createInvite(invitationContext(), nil, nil, server, `{"matchId":"missing"}`); err == nil {
		t.Fatal("missing match accepted")
	}
}
func TestExpiredOrStartedInvitationIsRejected(t *testing.T) {
	for _, tc := range []struct {
		state   string
		expires int64
	}{{match.StateWaiting, time.Now().Unix() - 60}, {match.StateOver, time.Now().Unix() + 60}} {
		record, _ := json.Marshal(inviteRecord{MatchID: "test-match", ExpiresAt: tc.expires})
		server := &inviteServer{live: liveGame("arena", tc.state), stored: string(record)}
		if _, err := resolveInvite(invitationContext(), nil, nil, server, `{"code":"ABCDEF"}`); err == nil {
			t.Fatal("stale invitation accepted")
		}
	}
}
