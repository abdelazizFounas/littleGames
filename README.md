# LittleGames

A real-time multiplayer mini-game platform for desktop and mobile browsers,
built on a self-hosted [Nakama](https://heroiclabs.com/nakama/) server with
authoritative match logic in Go.

The whole repository — code, identifiers, comments, UI strings, commit
messages — is written in English.

> **Status: phase 0 (infrastructure).** The stack boots, Nakama loads a
> compiled Go runtime module, and the monorepo type-checks, lints and runs
> tests. No gameplay yet.

## Architecture in one paragraph

Game logic and networking are kept completely independent of the rendering
engine. `@littlegames/core` declares a `GameRenderer` contract that any engine
must implement, and games receive a renderer through injection, so a second
engine can be added later without touching logic, networking or the lobby. The
same applies to input: an abstract `InputSource` produces typed
`InputCommand`s, whether the device behind it is a keyboard, a touch surface or
a scripted opponent in a test.

## Version policy

Every tool, image and dependency is pinned to an exact version — never `latest`,
never a `^` range — and every number below was read from its source rather than
from memory. Lockfiles (`pnpm-lock.yaml`, `go.sum`) are committed.

Versions are re-checked at the start of each phase with `pnpm outdated` and
`go list -u -m all`.

**Last verified: 2026-08-05.**

### Runtime and languages

| Tool | Version | Source |
|---|---|---|
| Go | `1.26.5` | `https://go.dev/VERSION?m=text` |
| Node | `24.19.0` (LTS "Krypton") | `https://nodejs.org/dist/index.json` |
| pnpm | `11.20.0` | `npm view pnpm version` |

### Frontend

| Package | Version | Source |
|---|---|---|
| typescript | `7.0.2` | `npm view typescript version` |
| vite | `8.2.0` | `npm view vite version` |
| @vitejs/plugin-react | `6.0.5` | `npm view @vitejs/plugin-react version` |
| react / react-dom | `19.2.8` | `npm view react version` |
| @types/react | `19.2.18` | `npm view @types/react version` |
| @types/react-dom | `19.2.4` | `npm view @types/react-dom version` |
| @types/node | `26.1.2` | `npm view @types/node version` |
| react-router | `8.3.0` | `npm view react-router version` |
| pixi.js | `8.19.0` | `npm view pixi.js dist-tags` |
| @heroiclabs/nakama-js | `2.8.0` | `npm view @heroiclabs/nakama-js version` |

Packages not yet installed are the ones whose phase has not started; the
versions above are the ones that will be pinned when they are.

### Quality and build

| Package | Version | Source |
|---|---|---|
| vitest | `4.1.10` | `npm view vitest version` |
| oxlint | `1.77.0` | `npm view oxlint version` |
| oxlint-tsgolint | `7.0.2001` | `npm view oxlint-tsgolint version` |
| ts-proto | `2.12.0` | `npm view ts-proto version` |
| @bufbuild/buf | `1.72.0` | `npm view @bufbuild/buf version` |

### Server and infrastructure

| Image / module | Version | Source |
|---|---|---|
| heroiclabs/nakama | `3.40.0` | Docker Hub tags API |
| heroiclabs/nakama-pluginbuilder | `3.40.0` | Docker Hub tags API |
| postgres | `18.4-trixie` | Docker Hub tags API |
| caddy | `2.11.4` | Docker Hub tags API |
| github.com/heroiclabs/nakama-common | `v1.47.0` | `proxy.golang.org` |
| google.golang.org/protobuf | `v1.36.11` | `proxy.golang.org` |

### Pinning constraints worth knowing

- **The Go toolchain version is imposed, not chosen.** The server module is a
  Go plugin (`.so`), and a plugin only loads when it was compiled by the same
  Go toolchain, against the same versions of the dependencies it shares with
  the host binary. Those values come straight from Nakama 3.40.0's own
  `go.mod`. This is why the module is built through
  `heroiclabs/nakama-pluginbuilder:3.40.0` and never with a locally installed
  Go — you do not need Go on your machine at all. Bump the pluginbuilder tag
  and the Nakama tag together, never one alone.
- **TypeScript 7 dropped the JavaScript compiler API.** The package now ships a
  native per-platform binary, so `typescript-eslint` (capped at
  `typescript <6.1.0`) cannot work, and ESLint alone cannot parse TypeScript.
  Linting is therefore handled by `oxlint`, with type-aware rules provided by
  `oxlint-tsgolint`.
- **PixiJS 8 initialises asynchronously.** `new Application()` no longer builds
  a renderer; `await app.init()` is required. `GameRenderer.mount` is `async`
  to absorb exactly this.

## Prerequisites

- Docker with Compose v2 or later
- Node `24.19.0` and pnpm `11.20.0` (`nvm use` picks up `.nvmrc`)

Go is **not** required locally.

## Getting started

```sh
# 1. Install JavaScript dependencies
pnpm install

# 2. Create your local environment file and replace every placeholder value
cp .env.example .env

# 3. Build the Go module and start Nakama, PostgreSQL and Caddy
pnpm server:up
```

`.env` is git-ignored, and no secret is ever hard-coded anywhere else.

Once the stack is healthy:

| Endpoint | Default local address |
|---|---|
| Client API and realtime socket | `http://localhost` (proxied to Nakama `:7350`) |
| Nakama developer console | `http://localhost:8080` (proxied to Nakama `:7351`) |

Log in to the console with `NAKAMA_CONSOLE_USERNAME` and
`NAKAMA_CONSOLE_PASSWORD` from your `.env`.

Nakama's ports are not published on the host: Caddy is the only entry point,
which is also what terminates TLS and upgrades WebSocket connections. Point
`CADDY_SITE_ADDRESS` at a real hostname and Caddy provisions certificates on
its own.

Useful commands:

```sh
pnpm server:logs    # follow Nakama logs
pnpm server:down    # stop the stack
```

## Checking that it works

```sh
pnpm typecheck   # tsc 7, strict, across the workspace
pnpm lint        # oxlint with type-aware rules
pnpm test        # vitest
```

To confirm the Go module was really compiled and loaded, look for this line in
the Nakama logs:

```sh
pnpm server:logs | grep "LittleGames runtime module loaded"
```

That line is the phase 0 proof: it can only appear if the plugin's ABI matches
the server binary.

## Repository layout

```
packages/
  core/            Shared contracts and protocol. Zero runtime dependencies.
server/
  nakama/          Go runtime module (match handlers, RPCs, hooks)
  docker/          Compose stack, plugin build, Caddy and Nakama config
```

Packages arrive as their phase begins, so that nothing in the tree is a
placeholder.
