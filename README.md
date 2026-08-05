# LittleGames

A real-time multiplayer mini-game platform for desktop and mobile browsers,
built on a self-hosted [Nakama](https://heroiclabs.com/nakama/) server with
authoritative match logic in Go.

The whole repository — code, identifiers, comments, UI strings, commit
messages — is written in English.

> **Status: phase 4 (Pong rules).** The rules exist as pure TypeScript and as a
> Go port that runs the authoritative match, both held to the same conformance
> vectors. A full match plays to its end in a unit test with no browser.
> Rendering comes next.

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

`pixi.js` is not installed yet: its phase has not started. The version above is
the one that will be pinned when it is.

### Quality and build

| Package | Version | Source |
|---|---|---|
| vitest | `4.1.10` | `npm view vitest version` |
| @bufbuild/protobuf | `2.13.0` | `npm view @bufbuild/protobuf version` |
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
- Node `24.19.0` — `nvm use` picks it up from `.nvmrc`
- pnpm `11.20.0` — no manual install needed: Corepack ships with Node and
  resolves the exact version from the `packageManager` field, which is what
  guarantees everyone builds with the pinned one. `corepack install` pre-caches
  it if you would rather not be prompted on first use.

Go is **not** required locally.

## Getting started

```sh
# 1. Install JavaScript dependencies
pnpm install

# 2. Create your local environment file and replace every placeholder value
cp .env.example .env

# 3. Build the Go module and start Nakama, PostgreSQL and Caddy
pnpm server:up

# 4. In another terminal, start the web client
pnpm dev
```

The app is then on **`http://localhost`**. Click **Play as guest** and the home
screen greets you by name.

Vite prints its own `http://localhost:5173` address on start-up. Use
`http://localhost` instead: that is the origin the client is configured for, and
the only one where the app and the API share a scheme, host and port.

`.env` is git-ignored, and no secret is ever hard-coded anywhere else.

Once the stack is healthy:

| Endpoint | Default local address |
|---|---|
| Web client | `http://localhost` |
| Client API and realtime socket | `http://localhost/v2/*`, `http://localhost/ws` |
| Nakama developer console | `http://localhost:8080` |

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

## The match protocol

`packages/core/proto` holds the only definition of what travels over a match
socket. Go and TypeScript are both generated from it, so the two sides cannot
drift apart; editing generated output is always wrong.

```sh
pnpm proto     # regenerate after editing a .proto
```

Generated files are committed, so a clone builds and runs without protoc, buf
or a Go toolchain. The generator itself needs none of those either: protoc-gen-go
is built inside the same pluginbuilder image the server module is compiled with,
which keeps it on the exact protobuf version Nakama is built against.

One `.proto` produces three artefacts, and the split is deliberate:

| Output | Contents | Why |
|---|---|---|
| `packages/core/src/protocol` | types only, zero imports | keeps core free of runtime dependencies, so game logic can be tested in Node without a protobuf runtime |
| `packages/net/src/protocol` | types plus the wire codec | the codec needs a protobuf runtime, which belongs next to the socket |
| `server/nakama/protocol` | Go types and codec | the authoritative side |

### Checking two clients really talk

Unit tests cannot cover this: what matters is that two separate sockets agree
with a server holding the only authoritative copy. With the stack up:

```sh
set -a && . ./.env && set +a
pnpm --filter @littlegames/net verify:match
```

It signs in two players, puts them in one match, sends input from one and reads
the server's echo from the other, measures the tick rate, and checks that a
third player is turned away.

### Two clocks, not one

A match has two counters and they start at different moments, which is easy to
misread when watching a snapshot:

| Counter | Starts |
|---|---|
| Nakama's `tick` | when the match is **created**, before anyone joins |
| The Pong countdown | when the **second** player joins |

A match therefore ticks, and broadcasts nothing, while it waits for an
opponent. `match.max_empty_sec` stops one that stays empty: the handler already
closes a match when its last player leaves, but a match created and never joined
has no departure to react to, and would otherwise tick thirty times a second for
as long as the server runs.

### A race worth knowing about

`match.find` lists open matches and creates one when it finds none. Nakama
flushes match labels to the index that listing searches on an interval —
`match.label_update_interval_ms`, tuned down from its 1000 ms default in
`nakama.yml`. Two players who ask inside the same window each get their own
match, because neither can see the other's yet.

Human clicks are never that close, but the race is real. Nakama's matchmaker is
the race-free primitive and is what random opponent matching will use rather
than this function.

## The rules exist twice

The simulation runs on the server, in Go, and will also run on the client to
predict ahead of it. Two implementations of the same rules drift, and a drift
between prediction and truth is what makes a ball appear to teleport.

`packages/games/pong/logic` is the reference, in pure TypeScript with no
rendering and no networking. `server/nakama/pong` is the port. Neither is
trusted to stay in step by review:

```sh
pnpm --filter @littlegames/pong-logic vectors   # regenerate after a rules change
pnpm test                                       # TypeScript replays them
./tools/scripts/test-go.sh                      # Go replays the same file
```

`testdata/vectors.json` records three scenarios tick by tick, one of which
plays a match to the winning score. Both implementations replay them and must
land on identical numbers. The guard is tight: nudging the Go ball's speed gain
by one part in ten million is caught at tick 150.

Keeping that possible constrains how the physics may be written. Only `+`, `-`,
`*`, `/`, comparisons and square root appear in it, all exactly rounded by
IEEE-754 in both languages. Trigonometry is not, so a bounce angle comes from a
square root rather than a cosine.

### Proving the rules are free of the renderer

`packages/renderer-headless` implements the rendering contract and draws
nothing. A unit test plays a full match against it, to the winning score, with
no browser and no network. If that keeps passing, nothing in the rules reaches
for a canvas, and a second engine can be added later without touching them.

## Repository layout

```
packages/
  core/            Shared contracts and protocol. Zero runtime dependencies.
  net/             Nakama client, session lifecycle, accounts, match sockets.
  games/pong/logic Pong rules and physics. Pure TypeScript, the reference.
  renderer-headless A renderer that draws nothing, for headless matches.
  ui/              React shell: routing, authentication, profile, catalogue.
server/
  nakama/          Go runtime module (match handlers, RPCs, hooks)
  docker/          Compose stack, plugin build, Caddy and Nakama config
```

Packages arrive as their phase begins, so that nothing in the tree is a
placeholder.

`net` is the only package that imports the Nakama SDK. It re-exports what the
shell needs, so no screen talks to the backend directly and swapping the
backend stays a change to one package.

## The game catalogue

The list of games lives in Nakama's storage engine, in the `catalog`
collection, so it can be edited from the Nakama console without a
redeployment. The server seeds only the entries that are missing, which means
an edited entry survives every restart.

Clients read it and never write it. Two separate locks enforce that, because
either one alone is insufficient:

- A `before` hook rejects any client write or delete in the collection.
- The client scopes its listing to the server-owned entries.

The reason for the second lock is not obvious. Storage objects are namespaced
by owner, so a client write to `catalog` does not overwrite the server's entry —
it creates one owned by that player. A player may mark their own object
public-read, and an unscoped listing returns everything the caller may read, so
without the scoping one player could put an entry into everybody else's game
list.

## Configuration

Everything comes from a single `.env` at the repository root, which the Vite
build also reads.

Variables prefixed with `VITE_` are embedded verbatim in the browser bundle, so
none of them may hold a secret. The Nakama server key is the one value both
sides need: it is declared once as `NAKAMA_SOCKET_SERVER_KEY` and injected into
the bundle at build time, so the client and the server cannot drift apart. It is
public by design and authorises nothing beyond opening a session.

Caddy is the single entry point and serves the client and the API on one
origin: it routes `/v2/*`, `/ws` and `/healthcheck` to Nakama, and everything
else to the web client. Development is therefore same-origin exactly as
production is, so no CORS rule has to exist purely for development, and deep
links such as `/profile` survive a reload through the client's SPA fallback.

In development the client behind Caddy is the Vite dev server, running on the
host. Reaching a host process from inside a container is platform-dependent —
under Docker Desktop, `host.docker.internal` and `host-gateway` both point at
the Windows or macOS host rather than at the WSL2 distribution a Linux shell
runs in, so neither can see the dev server. `pnpm server:up` therefore resolves
the address with `tools/scripts/resolve-web-upstream.sh`, which reads the
interface holding the default route and works on WSL2, native Linux and macOS
alike. It is resolved at start-up rather than stored, because a WSL2 restart
changes it.
