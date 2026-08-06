# LittleGames

A real-time multiplayer mini-game platform for desktop and mobile browsers,
built on a self-hosted [Nakama](https://heroiclabs.com/nakama/) server with
authoritative match logic in Go.

The whole repository — code, identifiers, comments, UI strings, commit
messages — is written in English.

> **Status: live at [little-games.fr](https://little-games.fr).** All eight
> phases done, and a second game on top of them: Battleship joins Pong, with
> placement, turns, per-recipient snapshots and a PixiJS board of its own. It is
> the first real test of the claim the architecture was built on — that the
> second game would be cheap.

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

Each game brings its own `.proto`. The socket, the seat and the backoff are
shared — `openMatchSocket` in `packages/net` carries bytes and an op code and
has no opinion about either — and each game reads those bytes with its own
protocol on top.

### Checking two clients really talk

Unit tests cannot cover this: what matters is that two separate sockets agree
with a server holding the only authoritative copy. With the stack up:

```sh
set -a && . ./.env && set +a
pnpm --filter @littlegames/net verify:match        # Pong
pnpm --filter @littlegames/net verify:battleship   # Battleship
```

The first signs in two players, puts them in one match, sends input from one
and reads the server's echo from the other, measures the tick rate, and checks
that a third player is turned away.

The second plays a whole game of Battleship to a win and then reads what each
player was told. It checks that a Pong lobby does not appear in the Battleship
list, that each player is sent their own fleet in full, and — the point of the
whole exercise — that no cell of the opponent's waters ever appears in a
snapshot the recipient had not already fired at. Not only in the last snapshot:
in every snapshot either player ever received.

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

`lobby.auto` lists the open lobbies for a game and opens one when it finds
none. Nakama flushes match labels to the index that listing searches on an
interval — `match.label_update_interval_ms`, tuned down from its 1000 ms
default in `nakama.yml`. Two players who ask inside the same window each get
their own lobby, because neither can see the other's yet.

Human clicks are never that close, but the race is real. Nakama's matchmaker is
the race-free primitive and is what random opponent matching will use rather
than this function.

The lobby calls all take the game from the request and check it against the
handlers actually registered: the id goes into a search query and into
`MatchCreate`, and neither is somewhere to put whatever a client sent. A
Pong lobby and a Battleship lobby never appear in each other's list.

## The rules exist twice

The simulation runs on the server, in Go, and will also run on the client to
predict ahead of it. Two implementations of the same rules drift, and a drift
between prediction and truth is what makes a ball appear to teleport.

`packages/games/pong/logic` is the reference, in pure TypeScript with no
rendering and no networking. `server/nakama/pong` is the port. Neither is
trusted to stay in step by review:

```sh
pnpm --filter @littlegames/pong-logic vectors        # regenerate after a rules change
pnpm --filter @littlegames/battleship-logic vectors  # the same, for Battleship
pnpm test                                            # TypeScript replays them
./tools/scripts/test-go.sh                           # Go replays the same files
```

`testdata/vectors.json` records three scenarios tick by tick, one of which
plays a match to the winning score. Both implementations replay them and must
land on identical numbers. The guard is tight: nudging the Go ball's speed gain
by one part in ten million is caught at tick 150.

Keeping that possible constrains how the physics may be written. Only `+`, `-`,
`*`, `/`, comparisons and square root appear in it, all exactly rounded by
IEEE-754 in both languages. Trigonometry is not, so a bounce angle comes from a
square root rather than a cosine.

Battleship keeps the same arrangement for a much smaller price. It is integer
arithmetic on a grid with no floating point anywhere, so there is no bit-level
drift to guard against — but the vectors still tie the two copies together, and
the TypeScript one earns its place beyond testing: it checks a placement
locally, so dropping a ship somewhere illegal is refused under the cursor
rather than after a round trip.

### Proving the rules are free of the renderer

`packages/renderer-headless` implements the rendering contract and draws
nothing. A unit test plays a full match against it, to the winning score, with
no browser and no network. If that keeps passing, nothing in the rules reaches
for a canvas, and a second engine can be added later without touching them.

## How the picture is built

The server is the only authority, and it is always a round trip in the past.
Two different techniques close that gap, and they pull in opposite directions:

- **Your own paddle is predicted.** Inputs are applied locally the moment they
  happen, using the very same paddle rule the server runs, and are replayed on
  top of each authoritative state until the server acknowledges them. Waiting
  for the round trip instead would make the paddle answer a key visibly late,
  which is the one lag a player feels immediately.
- **The ball and the opponent are interpolated, 100 ms behind.** Drawing the
  newest snapshot the instant it lands means moving only when one lands, so
  network jitter becomes visible stutter. Holding a small delay means there is
  almost always a later snapshot to move towards.

When nothing arrives in time the picture freezes on the newest state rather
than extrapolating. Inventing motion the server never sent has to be visibly
undone the moment it turns out wrong.

React is not part of any of this. The loop is plain TypeScript on
`requestAnimationFrame`; React places a `div` on the page and is told only
about events worth a re-render, such as connecting or failing. Input is sampled
on the server's cadence rather than the display's, so a 144 Hz screen does not
send five times what a 60 Hz one does.

The `renderer-pixi` package of each game is the only place allowed to know
PixiJS exists, and both are reached through a dynamic `import()`. The catalogue
and lobby never carry a rendering engine: the built entry chunk contains no
PixiJS at all, and the engine arrives in its own chunks when a match starts.

## The second game

Battleship is the first thing built on this architecture that Pong did not pay
for, and most of it was already there: the catalogue, lobbies, passwords,
invitations, the resume list, stats, notifications and the reconnecting socket
are all reused without a line changed. What the game brought of its own is a
`.proto`, rules in TypeScript and Go, a match handler, a board to draw it on,
and one row in the catalogue seed.

Three things about it are worth reading before the code.

**A client is sent only what it has discovered.** Its own fleet in full, and of
the opponent's waters nothing but the cells it has already fired at. Sending
the whole board and hiding it in the interface would put the answer in the
browser, where anyone can read it — the same reasoning that keeps a lobby
password server-side. So the snapshot is built per recipient, which is a
departure from Pong, where both players are sent the same broadcast.

**A turn-based game still has a render loop.** That was the assumption worth
getting wrong: nothing about the match changes between turns, but the water
does, sixty times a second, whether or not anyone has moved. So this game runs
on exactly the shape Pong does — a plain TypeScript loop on
`requestAnimationFrame`, with React outside it, told only about a phase
changing or a turn passing.

**Animation is presentation, never truth.** A torpedo takes half a second to
fly; the shot it depicts was resolved by the server the instant it was fired.
The renderer plays effects over the authoritative state rather than delaying
it, and starts them from *transitions* in that state — a shot that was not
there last frame, and exactly one of them. A board arriving in bulk is a
reconnection, not news, so a player who walks back into a game in progress does
not sit through every explosion that happened while they were away.

The tick rate is 10 Hz rather than Pong's 30. Nothing moves between turns, so
the loop exists only to pick up messages and answer them, and snapshots go out
reliably: a lost one here is a board that stays wrong until somebody moves,
where a lost Pong frame is replaced 33 ms later.

### Laying the fleet out

The five ships wait in a tray beside the board — named, drawn at the size they
will be, longest first. Drag one onto the grid and it snaps to the squares it
would occupy, green where it may go and red where it may not, refused under the
cursor rather than after a round trip. Drop a ship already placed back onto the
board to move it; pick it up by any of its cells and it stays held by that cell,
so a five-cell ship carried by its middle does not land five squares away.

While a fleet is being arranged the opponent's grid is not drawn at all. It is
empty, nothing can be done with it, and the room it was taking is the room the
board and the tray needed — which is the difference between comfortable and
unusable on a telephone. It appears when the game starts, which is also the
moment it starts meaning something.

Every button is also a key, because a hand already holding a ship with the mouse
should not have to put it down to turn it:

| | |
|---|---|
| `T`, or `R`, or right-click | turn the ship in hand |
| `Escape` | put it back in the tray |
| `Enter` | confirm the fleet |
| Arrange for me | a legal arrangement, dealt at random |

You can lay your fleet out before anybody else arrives, which is the emptiest
minute of the game and the obvious one to spend on it. The server has not opened
placement yet at that point, so a fleet confirmed then waits on the client and
goes the instant an opponent joins.

### Clicks become arithmetic

A canvas has no elements to click. The grids and the tray are drawn in fixed
logical units, so a pointer position divides down to a row and a column, or to
one of the ships waiting to be placed, and that division is the whole of the
input handling. `packages/games/battleship/renderer-pixi/src/layout.ts` is the
only place that geometry is written down, because drawing and reading have to
agree about it down to the unit; a unit test walks every cell of every grid and
every cell of every ship in the tray and reads each one back.

That is cheap, and it is also what this trades away: keyboard play and screen
readers came free with DOM elements and do not come free here. Worth doing
later as an explicit piece of work rather than pretended to now.

A finger gets the same gestures and two adjustments. Tapping a ship picks it up
and tapping a square puts it down, so nothing has to be dragged under a thumb
that hides it; and a ship that *is* dragged is carried a cell and a half above
the finger, clear of the hand. That lift applies to the carrying and to the
letting go, and to nothing else — what a press selects is whatever is genuinely
under it, or every tap would land somewhere other than where it was aimed.

Firing is the one irreversible thing on the screen, so a finger aims with one
tap and fires with a second on the same cell. A mouse has already shown its aim
on the way there and fires on the first click.

### Drawn procedurally, not from art

Water, hulls, torpedoes and explosions all come from `Graphics` and motion, so
nothing binary enters the repository and the look stays of a piece with the
sharp-edged interface around it. The waves are drawn once and then only ever
moved: each band is a ribbon twice as wide as the grid, slid sideways under a
mask and wrapped once it has travelled a whole grid's width, with wavelengths
that divide that width so the wrap lands on a whole number of crests. Rebuilding
the geometry every frame would re-tessellate some thousands of segments for a
picture that differs from the last by a few pixels of drift.

The grids stack on a screen taller than it is wide and sit side by side on one
wider than it is tall, because stacking them on a laptop letterboxes the pair
down to a narrow column. Arranging a fleet is a third and fourth arrangement
again — one grid and the tray. The stylesheet and the renderer switch on the
same thing, and the aspect ratios are asserted in the tests so they cannot
drift apart.

If sprite art ever replaces any of this, that package is the only one that
changes — which is the rendering contract doing its job.

## Coming back to a game

A player who walks away from a match sees it listed above the catalogue, and
can step back into it. The server keeps that list, one record per player per
match, readable by its owner and writable by nobody.

Each entry is checked against the server before being offered: a record can
outlive the match it names, and a door that opens onto nothing is worse than no
door. Stale ones are cleared as they are found, so the list tidies itself.

The record carries the lobby's password when it has one. The player was
admitted with it once already, and asking again on the way back would be
theatre.

## Lobbies

Three ways into a game, all of which resolve a lobby before the game screen is
reached. Landing there and being handed whatever was lying around is how a
player ends up in a stranger's game, or back in one already over.

| Button | What it does |
|---|---|
| Quick game | joins an open, unlocked lobby still waiting; opens one if there is none |
| Create lobby | opens one, with or without a password |
| List lobbies | shows who is waiting and whether their lobby is locked |

Nakama has no built-in password on a match, but it has the mechanism for one:
`joinMatch` carries metadata to the handler, which accepts or refuses. The
password is checked there, on the way in, and never in the browser — a check in
the browser is a suggestion. It is held in the match's own state, never in its
label: a label is public, and a lock that publishes its key is not one.

A wrong password is refused on the lobby list, before the game screen is
reached at all: the match answers a signal saying whether the password would be
accepted. That is a courtesy and not the lock — the door is still checked when
the socket joins, because anything that answers a question can be skipped by
not asking it.

Locked lobbies are listed but never handed to Quick game. Someone who asked for
a quick game did not ask for a door they have no key to.

## Invitations

An invitation carries the password too, when there is one: the host chose to
let this person in, so making them ask separately would defeat the link.

Opening a match mints a six-character code, and `/join/CODE` is the link that
leads to it. The code is drawn server-side from a cryptographic source: a
predictable one would let anyone walk into a private match by guessing the
next. Its alphabet leaves out the characters people read wrong — no `O` against
`0`, no `I` against `1` — because these codes get spoken aloud and typed from
screenshots. Lower case is accepted for the same reason.

Codes live in a storage collection no client can touch: permission zero on read
and write, plus the same hook that protects the catalogue. A client cannot mint
itself a code, read somebody else's, or find a match it was not invited to by
listing them. They expire after thirty minutes.

The join screen answers every way a link can fail with its own sentence — a
code that does not exist, one that has expired, one whose match has since
ended, one cut short in a chat — because a blank screen is the one outcome the
brief rules out.

### Where this departs from the brief

The brief has the server create a Nakama Party and hand back a code. It cannot:
the Go runtime exposes only `PartyList`, and a party is created by a client over
its socket, so there is no server-side party to mint a code for. The code
therefore points at the authoritative match itself, which needs no ready-screen
handshake and no transfer of a party into a match. The ready screen the brief
describes is not built.

## What a finished match leaves behind

Written by the server alone, from the state it simulated. A score the client
reported would be a score the client could choose.

| Where | What | Who may write it |
|---|---|---|
| Leaderboard `<game>_wins_weekly` | wins, reset every Monday | server |
| Storage `stats`, keyed by game | played, won, lost, points for and against | server |
| Notification | the result, persistent | server |

One board and one record per game, named after it: being good at Pong says
nothing about being good at Battleship, and a single board would have claimed
otherwise. Points mean whatever the game counts — goals for Pong, ships sunk
for Battleship.

A player may read their own record and nobody else's, and may write neither.
The same hook that protects the catalogue and the invitations refuses client
writes here, and reads are limited to the owner by the permission on the object
itself.

Recording is guarded against repeating: a match keeps ticking after it ends, so
without that the result would be written thirty times a second.

Notifications are persistent, and sent whether the player is connected or not.
Someone whose opponent walked off, or who closed the tab on the last point,
still wants to know how it ended.

The analytics observers are `after` hooks throughout. An analytics failure must
never be able to refuse a player something they asked for, and a `before` hook
can.

## Surviving a bad network

A phone crossing from Wi-Fi to mobile data disappears for a few seconds. That
must be a pause, not a forfeit, and three things make it one:

- **The socket is rebuilt with a growing backoff**, starting at 250 ms because
  most drops are momentary, and stretching to 8 s because one that is not
  should not be met with a flood of attempts.
- **The server holds the seats open for thirty seconds.** Closing the match the
  moment the last socket dropped is what turned a handover into a lost game;
  the simulation keeps running and the seat is waiting.
- **What was buffered is thrown away on return.** It describes a moment the
  match has left, and blending it with what arrives now would replay the gap at
  speed. The brief calls that simulating blind.

The same applies to a tab sent to the background: the frame loop is cancelled
rather than left queueing frames nobody sees, and coming back empties the
buffer instead of interpolating across the jump in the clock.

Verified against a running server: a socket killed mid-match receives nothing
while it is down, and is back to receiving on a rebuilt one, in the same seat.

## Production

Live at **https://little-games.fr**, on a single VPS running the same three
containers as development. Only two things differ, and both are in
`server/docker/`: the client is built and baked into the Caddy image instead of
being proxied to a dev server, and the site addresses are hostnames instead of
ports.

```sh
tools/scripts/deploy.sh                 # deploy the current branch's HEAD
tools/scripts/deploy.sh main            # or a named ref
```

The server pulls the commit from GitHub rather than being rsynced from a working
tree, so what is running is always a commit that exists and can be checked out
again. Secrets are never sent: `/opt/littlegames/.env` was generated on the
machine and stays there.

```sh
ssh vps2                                # a shell on the server
ssh -L 8080:127.0.0.1:8080 vps2         # then the Nakama console at :8080
```

### HTTPS

Naming a hostname in `CADDY_SITE_ADDRESS` is the whole of it. That one decision
turns on Caddy's automatic TLS, which brings:

| | |
|---|---|
| certificate | Let's Encrypt, over the HTTP-01 challenge on port 80 |
| renewal | in the background, about 30 days before expiry — no cron entry, no restart |
| http:// | permanent redirect to https:// on every route, installed by Caddy |
| www | permanent redirect to the apex, so one origin holds the session |
| HSTS | one year, `includeSubDomains` |

The issuer is named explicitly rather than left to the default, so a failed
issue stays a failure instead of quietly becoming a different authority.
Certificates and the ACME account key live in the `caddy-data` volume, so a
rebuild re-issues nothing and cannot walk into Let's Encrypt's rate limits.

Port 80 must stay open. It carries the ACME challenge and the redirect, and
nothing else.

### What is exposed, and what is not

| Port | Reachable from | What |
|---|---|---|
| 80, 443 | the internet | Caddy |
| 8080 | `127.0.0.1` only | the Nakama console, down an SSH tunnel |
| 5432, 7349–7351 | the compose network only | PostgreSQL and Nakama |

`ufw` allows 22, 80 and 443. Password authentication over SSH is off; the server
takes keys only. The production overlay replaces the port list rather than
adding to it — Compose concatenates them across files, and without that the
development mapping would put the admin console on the public internet.

### Checking a deployment

The two-client checks take a host, so the same ones that run against a
development stack run against the real thing:

```sh
NAKAMA_HOST=little-games.fr NAKAMA_PORT=443 NAKAMA_USE_SSL=true \
NAKAMA_SOCKET_SERVER_KEY=... \
pnpm --filter @littlegames/net verify:battleship
```

Worth doing after every deploy. The routing bug that served the client's own
HTML in answer to a login only existed in the production Caddyfile, and only
this found it.

## Installing it

The client is a PWA. The shell is precached so it opens without a network;
nothing under the API is, because a match is live state and a cached snapshot
of it would be a lie told confidently. It installs in fullscreen and landscape,
which is what a match wants.

## Repository layout

```
packages/
  core/            Shared contracts and protocols. Zero runtime dependencies.
  net/             Nakama client, session lifecycle, accounts, match sockets.
  games/
    pong/logic                Pong rules and physics. Pure TypeScript.
    pong/renderer-pixi        The field, the paddles and the ball.
    battleship/logic          Battleship rules: placement, firing, victory.
    battleship/renderer-pixi  The two grids, the water and what lands on it.
  renderer-headless A renderer that draws nothing, for headless matches.
  ui/              React shell: routing, authentication, profile, catalogue.
server/
  nakama/          Go runtime module (match handlers, RPCs, hooks)
  docker/          Compose stack, plugin build, Caddy and Nakama config
```

Packages arrive as their phase begins, so that nothing in the tree is a
placeholder. The two `renderer-pixi` packages are the only ones that import
PixiJS, and `packages/ui/src/features/game/game-stage.tsx` is the only place
the two games are told apart at all — everything above it is the same code for
both.

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
