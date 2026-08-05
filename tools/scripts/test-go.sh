#!/bin/sh
# Runs the Go tests for the server module.
#
# There is no local Go toolchain by design, so the tests run inside the same
# pluginbuilder image the module is compiled with. The whole repository is
# mounted rather than just server/, because the conformance test reads the
# vectors the TypeScript reference implementation writes — it reads the one
# file, never a copy, since a copy would be free to drift.
set -eu

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"

exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e GOCACHE=/tmp/go-build \
  -e GOMODCACHE=/tmp/go-mod \
  -v "$ROOT:/workspace" \
  -w /workspace/server/nakama \
  --entrypoint go \
  heroiclabs/nakama-pluginbuilder:3.40.0 \
  test "$@" ./...
