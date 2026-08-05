// Package analytics records the funnel the brief asks to follow, from arriving
// to actually playing.
package analytics

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

// Register attaches the observers.
//
// They are `after` hooks throughout: an analytics failure must never be able to
// refuse a player something they asked for, and a `before` hook can.
func Register(logger runtime.Logger, initializer runtime.Initializer) error {
	if err := initializer.RegisterAfterAuthenticateDevice(func(
		_ context.Context,
		hookLogger runtime.Logger,
		_ *sql.DB,
		_ runtime.NakamaModule,
		out *api.Session,
		_ *api.AuthenticateDeviceRequest,
	) error {
		// `created` is what separates a first arrival from a return visit,
		// which is the top of the funnel.
		hookLogger.Info("analytics: session opened, new account=%v", out.GetCreated())
		return nil
	}); err != nil {
		return fmt.Errorf("register the authentication observer: %w", err)
	}

	if err := initializer.RegisterAfterListStorageObjects(func(
		_ context.Context,
		hookLogger runtime.Logger,
		_ *sql.DB,
		_ runtime.NakamaModule,
		_ *api.StorageObjectList,
		in *api.ListStorageObjectsRequest,
	) error {
		if in.GetCollection() == "catalog" {
			hookLogger.Info("analytics: catalogue viewed")
		}
		return nil
	}); err != nil {
		return fmt.Errorf("register the catalogue observer: %w", err)
	}

	logger.Info("Analytics observers registered")
	return nil
}
