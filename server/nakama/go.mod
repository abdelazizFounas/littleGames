// Placeholder module path: this module is never published, and is only ever
// built as a Nakama plugin. Change it if the project gains a git remote.
module littlegames.local/nakama

// Pinned to the exact toolchain Nakama 3.40.0 is built with. A Go plugin only
// loads when its compiler version and its shared dependency versions match the
// host binary, so this line is imposed, not chosen.
go 1.26.5

require github.com/heroiclabs/nakama-common v1.47.0

require google.golang.org/protobuf v1.36.11 // indirect
