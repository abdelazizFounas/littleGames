#!/bin/sh
# Regenerates Go and TypeScript from packages/core/proto.
#
# Generated files are committed, so a clone builds and runs without any of this
# tooling. You only need to run this after editing a .proto.
#
# There is no local Go toolchain in this project by design, so protoc-gen-go is
# built inside the same pluginbuilder image the server module is compiled with.
# That is what keeps the generator on the exact protobuf version Nakama itself
# is built against — a mismatch there produces code the runtime cannot use.
set -eu

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"

PLUGINBUILDER_IMAGE='heroiclabs/nakama-pluginbuilder:3.40.0'
PROTOC_GEN_GO_VERSION='v1.36.11'
PLUGIN_BIN="$ROOT/.tools/bin/protoc-gen-go"

if [ ! -x "$PLUGIN_BIN" ]; then
  echo "Building protoc-gen-go $PROTOC_GEN_GO_VERSION in $PLUGINBUILDER_IMAGE..."
  mkdir -p "$ROOT/.tools/bin"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e GOCACHE=/tmp/go-build \
    -e GOMODCACHE=/tmp/go-mod \
    -e GOBIN=/out \
    -v "$ROOT/.tools/bin:/out" \
    --entrypoint go \
    "$PLUGINBUILDER_IMAGE" \
    install "google.golang.org/protobuf/cmd/protoc-gen-go@$PROTOC_GEN_GO_VERSION"
fi

echo 'Linting protocol definitions...'
./node_modules/.bin/buf lint

echo 'Generating...'
./node_modules/.bin/buf generate

echo 'Done. Review and commit the generated files.'
