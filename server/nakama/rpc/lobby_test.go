package rpc

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"littlegames.local/nakama/match"
)

type quickLobbyServer struct {
	runtime.NakamaModule
	created int
	full    bool
}

// Deliberately return an empty index, as Nakama does before label refresh.
func (s *quickLobbyServer) MatchList(context.Context, int, bool, string, *int, *int, string) ([]*api.Match, error) {
	return nil, nil
}
func (s *quickLobbyServer) MatchCreate(context.Context, string, map[string]interface{}) (string, error) {
	s.created++
	return fmt.Sprintf("room-%d", s.created), nil
}
func (s *quickLobbyServer) MatchSignal(context.Context, string, string) (string, error) {
	if s.full {
		return "full", nil
	}
	return match.SignalOK, nil
}

func TestSimultaneousQuickPlaySharesAnUnindexedLobby(t *testing.T) {
	quickLobbies[match.PongName] = &quickLobby{}
	t.Cleanup(func() { quickLobbies[match.PongName] = &quickLobby{} })
	server := &quickLobbyServer{}
	results := make([]string, 2)
	errors := make([]error, 2)
	var callers sync.WaitGroup
	for i := range results {
		callers.Go(func() { results[i], errors[i] = autoLobby(context.Background(), nil, nil, server, `{"game":"pong"}`) })
	}
	callers.Wait()
	for _, err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	if server.created != 1 || results[0] != results[1] {
		t.Fatalf("simultaneous players were split: %v (created %d)", results, server.created)
	}
	// A cached room is only a candidate. A full or finished room must not be reused.
	server.full = true
	next, err := autoLobby(context.Background(), nil, nil, server, `{"game":"pong"}`)
	if err != nil {
		t.Fatal(err)
	}
	if next == results[0] || server.created != 2 {
		t.Fatal("a full cached room was offered again")
	}
}
