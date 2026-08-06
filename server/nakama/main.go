// Package main implements the LittleGames server runtime module for Nakama.
//
// Nakama loads the compiled shared object from its runtime path and looks up
// the InitModule symbol. The server type-asserts that symbol against an exact
// signature, so InitModule below must keep it verbatim or the module is
// rejected at startup.
package main

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/heroiclabs/nakama-common/runtime"
	"littlegames.local/nakama/analytics"
	"littlegames.local/nakama/catalog"
	"littlegames.local/nakama/match"
	"littlegames.local/nakama/rpc"
	"littlegames.local/nakama/stats"
)

// InitModule is the entry point Nakama calls once, at server startup, after
// the plugin has been loaded.
func InitModule(
	ctx context.Context,
	logger runtime.Logger,
	db *sql.DB,
	nk runtime.NakamaModule,
	initializer runtime.Initializer,
) error {
	// Returning the error aborts startup on purpose: a server whose catalogue
	// failed to seed would serve an empty game list and look merely empty
	// rather than broken.
	if err := catalog.Seed(ctx, logger, nk); err != nil {
		return err
	}

	if err := catalog.RegisterGuards(initializer); err != nil {
		return err
	}

	handlers := map[string]func() runtime.Match{
		match.PongName:       func() runtime.Match { return &match.PongMatch{} },
		match.BattleshipName: func() runtime.Match { return &match.BattleshipMatch{} },
		match.ArenaName:      func() runtime.Match { return &match.ArenaMatch{} },
	}
	for name, build := range handlers {
		make := build
		if err := initializer.RegisterMatch(name, func(
			_ context.Context,
			_ runtime.Logger,
			_ *sql.DB,
			_ runtime.NakamaModule,
		) (runtime.Match, error) {
			return make(), nil
		}); err != nil {
			return fmt.Errorf("register the %s match handler: %w", name, err)
		}
	}

	// One weekly board per game. A win at one says nothing about the other.
	for game := range rpc.KnownGames {
		if err := stats.EnsureLeaderboard(ctx, logger, nk, game); err != nil {
			return err
		}
	}

	if err := rpc.Register(initializer); err != nil {
		return err
	}

	if err := analytics.Register(logger, initializer); err != nil {
		return err
	}

	logger.Info("LittleGames runtime module loaded")
	return nil
}
