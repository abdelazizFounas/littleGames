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

	"github.com/heroiclabs/nakama-common/runtime"
)

// InitModule is the entry point Nakama calls once, at server startup, after
// the plugin has been loaded.
//
// Phase 0 registers nothing: it only proves the plugin was compiled against a
// matching toolchain and is being executed by the server. Match handlers, RPCs
// and hooks are registered here from phase 3 onwards.
func InitModule(
	ctx context.Context,
	logger runtime.Logger,
	db *sql.DB,
	nk runtime.NakamaModule,
	initializer runtime.Initializer,
) error {
	logger.Info("LittleGames runtime module loaded")
	return nil
}
