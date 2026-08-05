#!/bin/sh
# Prints the address Caddy must use to reach the Vite dev server running on this
# machine, as `host:port`.
#
# Reaching the host from inside a container is platform-dependent, and the usual
# shortcuts do not survive every platform:
#
#   - Under Docker Desktop, `host.docker.internal` and `host-gateway` both point
#     at the Windows or macOS host. That host is *not* the WSL2 distribution a
#     Linux shell runs in, so on WSL2 they resolve to an address that cannot see
#     the dev server at all.
#   - The Compose bridge gateway has the same problem: Docker Desktop runs
#     containers in a separate VM, so its gateway is not this machine.
#
# The address of the interface holding the default route does work in all three
# cases — WSL2, native Linux and macOS — which is why it is what we resolve.
#
# The result is not cached: a WSL2 restart changes it.
set -eu

PORT="${WEB_UPSTREAM_PORT:-5173}"
ADDRESS=''

if command -v ip >/dev/null 2>&1; then
  ADDRESS="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.*src \([0-9.]*\).*/\1/p' | head -1)"
elif command -v ipconfig >/dev/null 2>&1; then
  ADDRESS="$(ipconfig getifaddr en0 2>/dev/null || true)"
fi

if [ -z "$ADDRESS" ]; then
  # Correct on macOS and on Windows outside WSL, and a clearer failure than an
  # empty upstream everywhere else.
  ADDRESS='host.docker.internal'
fi

printf '%s:%s\n' "$ADDRESS" "$PORT"
