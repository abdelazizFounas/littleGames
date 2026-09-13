# Production validation and deployment

All application code, documentation, and interface text use English. The public
catalog has five games: Rift Arena (3D), Neon Pong, Fleet Command, Pocket Artillery, and Ice Clash (2D).
All five games include local practice against bots, with Easy, Hard, and Extra Hard settings. Fleet Command uses a responsive DOM/SVG console for both practice and online play. Online games use Nakama's
authoritative Go simulation, with matching TypeScript rules on the client.

## Local development

Use the repository's pinned Node 24.19.0, pnpm 11.20.0, and Go 1.26.5 versions.
Install dependencies with `pnpm install --frozen-lockfile`. Copy `.env.example`
to `.env` only when no configuration exists, then replace the example values.
`pnpm dev` serves the UI. `pnpm server:up` starts the development Docker stack;
its Caddy origin serves both the UI and the API. Solo practice also works with
just the UI dev server.

## Release checks

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:production
pnpm audit
(cd server/nakama && go test ./...)
```

`pnpm check` runs TypeScript checking, lint, unit tests, and the PWA production
build. Browser tests cover desktop and mobile catalog layouts, filtering,
sign-in routing, help pages, practice lifecycle, and independent touch pointers.
`pnpm test:production` builds the app and verifies all five practice games
offline under the exact Content Security Policy from the production Caddyfile.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium installation.

With a running test Nakama server, run the real two-client checks separately:

```sh
export NAKAMA_HOST=127.0.0.1 NAKAMA_PORT=7350 NAKAMA_USE_SSL=false
export NAKAMA_SOCKET_SERVER_KEY=your-public-server-key
pnpm --filter @littlegames/net verify:match
pnpm --filter @littlegames/net verify:battleship
pnpm --filter @littlegames/net verify:arena
```

Quick-play requests on the same Nakama node share newly created lobbies even
before the asynchronous match-label index refreshes. The supplied Compose stack
runs one Nakama node; multi-node routing needs its own matchmaking validation.

These create test players and matches, so use an isolated database for routine
validation. The Arena check covers 60 Hz snapshots, speed limits, scoped hits,
respawns, and leaderboard recording. Battleship checks hidden fleets and a full
match. Pong checks shared lobbies, two players, and rejection of a third player.

## Deployment configuration

The production Compose stack builds the frontend, the Go plugin, and a self-hosted PeerJS signaling service. Caddy waits for Nakama and PeerServer health checks. `/peerjs` shares the application origin and needs no extra public port. Set these
values in the server's existing `.env` before building:

- `CADDY_SITE_ADDRESS`: the canonical public hostname, without a scheme.
- `CADDY_ALIAS_ADDRESS`: its alternate hostname, redirected to the canonical one.
- `CADDY_ACME_EMAIL`: the operator's certificate contact address.
- `CADDY_CONSOLE_ADDRESS`: `http://localhost:8080` (published on loopback only).
- `VITE_NAKAMA_HOST`: the same canonical public hostname.
- `VITE_NAKAMA_PORT`: `443`; `VITE_NAKAMA_USE_SSL`: `true`.
- Replace every example password, token signing key, and runtime HTTP key.

Only the Nakama socket server key is intentionally public. Never place a private
key in a `VITE_` variable. The browser and API must share an origin under the
production Content Security Policy. Pixi's static shader binding module allows
Pong to run without allowing JavaScript string evaluation.

Point the two hostnames at the host and allow ports 80 and 443. Preserve the
PostgreSQL and Caddy certificate volumes across releases. Keep a tested database
backup before deployment; restoring application code does not restore data.

From a reviewed, committed checkout on the target host:

```sh
docker compose --env-file .env \
  -f server/docker/docker-compose.yml \
  -f server/docker/docker-compose.prod.yml up -d --build
```

`tools/scripts/deploy.sh` is the existing SSH deployment path. It pushes a Git
ref, checks out its exact commit on the server, builds the stack, and exits with
failure if Nakama never becomes healthy. Uncommitted work is not deployed by
that script.

## Browser and operational acceptance

Check `/healthcheck`, guest sign-in, a private invite between two browser
profiles, ready/start, and reconnect after a reload on the canonical HTTPS
origin. Play each game once on a real mobile device and a desktop. Check the
browser console for WebGL and CSP failures. Online matches need a connection;
API calls and snapshots are never served from the offline cache.

After the first completed service-worker installation, the shell, guide, and
practice games are available offline. Updates are opt-in and their notice is
hidden during games. Hashed assets have immutable caching; HTML and the service
worker revalidate. PWA installation supports portrait and landscape browsing.

The redesign was checked locally with Chromium, including software WebGL,
multiple viewport sizes, real Nakama clients, production CSP, and offline
navigation. Automated accessibility scans cover the homepage, rules, sign-in,
Arena lobby, and privacy page; Arena and Pong canvas gameplay still needs human usability
review. The Docker stack, public HTTPS routing, and production invitations have also
been checked. Real-device Safari/Firefox testing and load testing remain
separate acceptance checks. These checks do not establish an unmeasured
player-capacity limit.

## Validation recorded for this change

- 653 TypeScript unit tests across 50 files passed.
- 46 desktop/mobile browser tests and the production/offline test cover all fifteen game/difficulty combinations, mobile fullscreen, real P2P voice, and match reconnects.
- Type checking, lint, production build, and all Go package tests passed.
- Go's race detector passed for the match handlers and RPC package.
- Live Pong, Fleet Command, and Arena verification scripts completed successfully.
- Two isolated browser profiles joined private Arena and Fleet Command invitations;
  Arena also rejoined its seat after reload without browser errors.
- The frontend and signaling dependency audits reported zero known advisories at validation time. PeerServer overrides `qs` to 6.16.0 to avoid the vulnerable Express transitive version.

Build output includes a size warning for the dynamically loaded 3D engine chunk. PeerJS is loaded only after joining voice.
The initial page does not load that renderer; the PWA intentionally precaches
practice assets to support offline play.

## Fleet Command and practice difficulty

Fleet Command uses the same accessible DOM/SVG board for online and local play.
Select a vessel and a grid position; the next unplaced ship is selected
immediately. R rotates the selected ship. Auto arrange produces a legal fleet.
Select an enemy coordinate and choose Fire torpedo to commit the shot. Arrow
keys navigate the grids. The interface never receives the opponent's hidden
fleet in either mode.

Each practice route accepts `?difficulty=easy`, `hard`, or `extra-hard`.
Changing the selector starts a new round, and links to other practice games
preserve the chosen difficulty. Arena changes reaction delay, aiming error,
firing cadence, and movement. Pong changes reaction delay, movement speed, and
bounce prediction. Fleet progresses from random search to pursuit and then
probability scoring using only public shot results. Scores stay off leaderboards.

Run the optional Fleet online browser test against an isolated Nakama server:

```sh
NAKAMA_INTEGRATION=1 NAKAMA_SOCKET_SERVER_KEY=your-public-test-key pnpm test:e2e
```

It checks private invitations, deployment before the opponent joins, firing,
hidden fleets, and reloading an active match. The regular browser suite does not
require a multiplayer server.

## Fleet combat effects and wreck disclosure

Live shots are presented in order: a torpedo crosses between the boards, then
the result appears with a splash or impact. A sunk ship becomes a visible wreck.
Practice pauses both the bot and the current effect; reduced-motion mode skips
travel. Reconnect snapshots restore shot history and wrecks without replaying
old torpedoes. Placement tests compare every preview cell's computed color,
including alternating tiles, vertical ships, board edges, and overlaps.

The protocol adds `Snapshot.revealed_ships` (field 13). The server only includes
placements whose cells have all been hit. Older clients ignore the extra field;
the current client also handles older snapshots with no revealed ships. Deploy
both the Nakama plugin and the web image to enable online wreck revelation.

The two-browser integration test sinks a known carrier, checks that neighboring
afloat ships stay private, verifies both flight directions and sinking effects,
and reloads the attacking client to check the retained wreck. All Go package
tests, type checking, lint, the production build, and production CSP/offline
validation passed for this update.

## Voice and new games

See [voice, Ice Clash, Pocket Artillery, and Arena settings](voice-and-hockey.md) for rules, controls, the Google STUN network limitation, signaling deployment, and integration checks. The microphone Permissions Policy permits the same origin; voice is opt-in and has no recordings.
