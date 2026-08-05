package rpc

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
	"littlegames.local/nakama/match"
)

const (
	// CreateInviteID mints a code for a match the caller is opening.
	CreateInviteID = "invite.create"
	// ResolveInviteID turns a code back into the match it points at.
	ResolveInviteID = "invite.resolve"
)

// InviteCollection holds one object per live invitation, keyed by its code.
//
// Written and read by the server alone: permission zero on both, so a client
// cannot mint itself a code, read somebody else's, or discover a match it was
// not invited to by listing them.
const InviteCollection = "invites"

// gRPC NOT_FOUND and INVALID_ARGUMENT, which Nakama maps to 404 and 400.
const (
	codeNotFound        = 5
	codeInvalidArgument = 3
)

// inviteAlphabet deliberately omits characters that are read wrong when a code
// is spoken aloud or typed from a screenshot: no O against 0, no I against 1.
const inviteAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

const inviteCodeLength = 6

// How long a code stays usable. Long enough to send a message and be answered,
// short enough that a link found later leads nowhere.
const inviteLifetime = 30 * time.Minute

type inviteRecord struct {
	MatchID   string `json:"matchId"`
	CreatedBy string `json:"createdBy"`
	ExpiresAt int64  `json:"expiresAt"`
}

type createInviteResponse struct {
	Code      string `json:"code"`
	MatchID   string `json:"matchId"`
	ExpiresAt int64  `json:"expiresAt"`
}

type resolveInviteRequest struct {
	Code string `json:"code"`
}

type resolveInviteResponse struct {
	MatchID string `json:"matchId"`
}

// newInviteCode draws a code from a cryptographic source.
//
// A predictable code would let anyone walk into a private match by guessing
// the next one, so this is not the place for a counter or a timestamp.
func newInviteCode() (string, error) {
	buffer := make([]byte, inviteCodeLength)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}

	var code strings.Builder
	code.Grow(inviteCodeLength)
	for _, value := range buffer {
		code.WriteByte(inviteAlphabet[int(value)%len(inviteAlphabet)])
	}
	return code.String(), nil
}

// createInvite opens a match and returns a code that leads to it.
func createInvite(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	_ string,
) (string, error) {
	userID, _ := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)

	matchID, err := nk.MatchCreate(ctx, match.PongName, nil)
	if err != nil {
		logger.Error("Failed to create a match for an invitation: %v", err)
		return "", runtime.NewError("could not open a match", codeInternal)
	}

	code, err := newInviteCode()
	if err != nil {
		logger.Error("Failed to draw an invitation code: %v", err)
		return "", runtime.NewError("could not create an invitation", codeInternal)
	}

	expiresAt := time.Now().Add(inviteLifetime).Unix()
	value, err := json.Marshal(inviteRecord{MatchID: matchID, CreatedBy: userID, ExpiresAt: expiresAt})
	if err != nil {
		return "", runtime.NewError("could not create an invitation", codeInternal)
	}

	if _, err := nk.StorageWrite(ctx, []*runtime.StorageWrite{{
		Collection:      InviteCollection,
		Key:             code,
		Value:           string(value),
		PermissionRead:  0,
		PermissionWrite: 0,
	}}); err != nil {
		logger.Error("Failed to store an invitation: %v", err)
		return "", runtime.NewError("could not create an invitation", codeInternal)
	}

	response, err := json.Marshal(createInviteResponse{Code: code, MatchID: matchID, ExpiresAt: expiresAt})
	if err != nil {
		return "", runtime.NewError("could not encode the response", codeInternal)
	}
	return string(response), nil
}

// resolveInvite turns a code back into a match, or explains why it cannot.
//
// The distinction between an unknown code and an expired one is deliberate:
// "this link has expired" tells the player to ask for a new one, where "no such
// code" would have them checking for a typo that is not there.
func resolveInvite(
	ctx context.Context,
	logger runtime.Logger,
	_ *sql.DB,
	nk runtime.NakamaModule,
	payload string,
) (string, error) {
	var request resolveInviteRequest
	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return "", runtime.NewError("that invitation code is not readable", codeInvalidArgument)
	}

	// Codes are shown in upper case and often retyped, so a lower-case one is a
	// transcription, not a different code.
	code := strings.ToUpper(strings.TrimSpace(request.Code))
	if len(code) != inviteCodeLength {
		return "", runtime.NewError("that invitation code is not valid", codeInvalidArgument)
	}

	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: InviteCollection,
		Key:        code,
	}})
	if err != nil {
		logger.Error("Failed to read an invitation: %v", err)
		return "", runtime.NewError("could not check that invitation", codeInternal)
	}
	if len(objects) == 0 {
		return "", runtime.NewError("that invitation does not exist", codeNotFound)
	}

	var record inviteRecord
	if err := json.Unmarshal([]byte(objects[0].GetValue()), &record); err != nil {
		logger.Error("Stored invitation %q is unreadable: %v", code, err)
		return "", runtime.NewError("that invitation is no longer usable", codeNotFound)
	}

	if time.Now().Unix() > record.ExpiresAt {
		return "", runtime.NewError("that invitation has expired", codeNotFound)
	}

	// A match that has already ended and been cleaned up leaves a code pointing
	// nowhere. Saying so beats sending the player into a match that is gone.
	if _, err := nk.MatchGet(ctx, record.MatchID); err != nil {
		return "", runtime.NewError("that match is no longer running", codeNotFound)
	}

	response, err := json.Marshal(resolveInviteResponse{MatchID: record.MatchID})
	if err != nil {
		return "", runtime.NewError("could not encode the response", codeInternal)
	}
	return string(response), nil
}

// registerInvites wires the invitation functions into the server.
func registerInvites(initializer runtime.Initializer) error {
	if err := initializer.RegisterRpc(CreateInviteID, createInvite); err != nil {
		return fmt.Errorf("register %s: %w", CreateInviteID, err)
	}
	if err := initializer.RegisterRpc(ResolveInviteID, resolveInvite); err != nil {
		return fmt.Errorf("register %s: %w", ResolveInviteID, err)
	}
	return nil
}
