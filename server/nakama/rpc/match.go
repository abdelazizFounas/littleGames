// Package rpc holds the custom server functions clients can call by name.
package rpc

import (
	"github.com/heroiclabs/nakama-common/runtime"
)

// gRPC INTERNAL, which Nakama maps to HTTP 500.
const codeInternal = 13

// Register wires the custom functions into the server.
func Register(initializer runtime.Initializer) error {
	if err := registerLobbies(initializer); err != nil {
		return err
	}
	return registerInvites(initializer)
}
