// Package catalog owns the list of playable games and puts it in storage.
package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

// gRPC PERMISSION_DENIED, which Nakama maps to HTTP 403.
const codePermissionDenied = 7

// Collection is the storage collection holding one object per game, keyed by
// game id.
const Collection = "catalog"

// Permissions applied to every catalogue entry.
//
// Readable by any signed-in player, writable by nobody: writes come from the
// server alone, so a client cannot add a game or rewrite one.
const (
	permissionPublicRead = 2
	permissionNoWrite    = 0
)

// Game is one entry of the catalogue, as stored and as sent to the client.
type Game struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Tagline     string `json:"tagline"`
	Description string `json:"description"`
	MinPlayers  int    `json:"minPlayers"`
	MaxPlayers  int    `json:"maxPlayers"`
}

// Entries the server creates when they are absent.
var seedEntries = []Game{
	{
		ID:          "pong",
		Name:        "Pong",
		Tagline:     "Two paddles, one ball, first to eleven.",
		Description: "The original head-to-head duel. The ball speeds up on every " +
			"exchange, and where it hits your paddle decides where it goes next.",
		MinPlayers: 2,
		MaxPlayers: 2,
	},
	{
		ID:      "battleship",
		Name:    "Battleship",
		Tagline: "Hide five ships, then find theirs first.",
		Description: "Place your fleet on the lower grid, then take turns firing at " +
			"the upper one. A hit keeps the turn, a miss hands it over, and the " +
			"first to sink all seventeen cells wins.",
		MinPlayers: 2,
		MaxPlayers: 2,
	},
	{
		ID:      "arena",
		Name:    "Arena",
		Tagline: "One arena, two players, first to seven.",
		Description: "A duel across a ravine you cannot cross and bullets can. " +
			"Crates to climb, cover to crouch behind, and a server that " +
			"rewinds time to judge every shot.",
		MinPlayers: 2,
		MaxPlayers: 2,
	},
}

// Seed creates the catalogue entries that do not exist yet.
//
// Only missing keys are written. An entry edited from the Nakama console keeps
// its edits across restarts, which is the whole reason the catalogue lives in
// storage instead of in this file: it stays editable without a redeployment.
func Seed(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) error {
	reads := make([]*runtime.StorageRead, 0, len(seedEntries))
	for _, game := range seedEntries {
		reads = append(reads, &runtime.StorageRead{Collection: Collection, Key: game.ID})
	}

	existing, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return fmt.Errorf("read catalogue: %w", err)
	}

	present := make(map[string]struct{}, len(existing))
	for _, object := range existing {
		present[object.GetKey()] = struct{}{}
	}

	writes := make([]*runtime.StorageWrite, 0, len(seedEntries))
	for _, game := range seedEntries {
		if _, found := present[game.ID]; found {
			continue
		}

		value, err := json.Marshal(game)
		if err != nil {
			return fmt.Errorf("encode catalogue entry %q: %w", game.ID, err)
		}

		writes = append(writes, &runtime.StorageWrite{
			Collection:      Collection,
			Key:             game.ID,
			Value:           string(value),
			PermissionRead:  permissionPublicRead,
			PermissionWrite: permissionNoWrite,
		})
	}

	if len(writes) == 0 {
		logger.Info("Game catalogue already present, nothing to seed")
		return nil
	}

	if _, err := nk.StorageWrite(ctx, writes); err != nil {
		return fmt.Errorf("write catalogue: %w", err)
	}

	logger.Info("Seeded %d game catalogue entries", len(writes))
	return nil
}

// GuardedCollections are the collections no client may touch directly.
//
// The catalogue is public information a client must not be able to rewrite.
// Invitations are the opposite: private, and readable only by the server, so
// that a code cannot be minted, harvested or brute-forced from the outside.
// Stats a player may read but never write: a record they could edit would be a
// claim rather than a fact.
var GuardedCollections = []string{Collection, "invites", "stats", "active"}

func isGuarded(collection string) bool {
	for _, guarded := range GuardedCollections {
		if collection == guarded {
			return true
		}
	}
	return false
}

// RegisterGuards blocks every client write into the guarded collections.
//
// Nakama namespaces storage objects by owner, so a client writing to this
// collection does not overwrite the server's entry: it creates one under its
// own user id. That is not harmless. A client may mark its object public-read,
// and a listing that is not scoped to an owner returns every object the caller
// can read — so one player could inject an entry into everybody else's game
// list. Reads are scoped to the system owner on the client side, and this hook
// closes the hole at its source rather than only hiding its effect.
func RegisterGuards(initializer runtime.Initializer) error {
	if err := initializer.RegisterBeforeWriteStorageObjects(rejectCatalogWrite); err != nil {
		return fmt.Errorf("register catalogue write guard: %w", err)
	}
	if err := initializer.RegisterBeforeDeleteStorageObjects(rejectCatalogDelete); err != nil {
		return fmt.Errorf("register catalogue delete guard: %w", err)
	}
	return nil
}

func rejectCatalogWrite(
	_ context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	in *api.WriteStorageObjectsRequest,
) (*api.WriteStorageObjectsRequest, error) {
	for _, object := range in.GetObjects() {
		if isGuarded(object.GetCollection()) {
			logger.Warn("Rejected a client write to %q, key %q", object.GetCollection(), object.GetKey())
			return nil, runtime.NewError("that collection is managed by the server", codePermissionDenied)
		}
	}
	return in, nil
}

func rejectCatalogDelete(
	_ context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	_ runtime.NakamaModule,
	in *api.DeleteStorageObjectsRequest,
) (*api.DeleteStorageObjectsRequest, error) {
	for _, object := range in.GetObjectIds() {
		if isGuarded(object.GetCollection()) {
			logger.Warn("Rejected a client delete in %q, key %q", object.GetCollection(), object.GetKey())
			return nil, runtime.NewError("that collection is managed by the server", codePermissionDenied)
		}
	}
	return in, nil
}
