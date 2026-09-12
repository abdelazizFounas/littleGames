# Production validation and deployment

All application code, documentation, and interface text use English. The public
catalog has three games: Rift Arena (3D), Neon Pong (2D), and Fleet Command (2D).
Arena and Pong include local practice against bots. Online games use Nakama's
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
`pnpm test:production` builds the app and verifies both practice renderers
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

The production Compose overlay builds the frontend and the Go plugin. Set these
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
both 2D games to run without allowing JavaScript string evaluation.

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
Arena lobby, and privacy page; canvas gameplay still needs human usability
review. Real-device Safari/Firefox testing, public TLS/DNS, the Docker production
stack, load testing, and an actual deployment were not performed in this
workspace. Local checks do not establish an unmeasured player-capacity limit.

## Validation recorded for this change

- 607 TypeScript unit tests across 43 files passed.
- Eight desktop/mobile browser tests and the production/offline test passed.
- Type checking, lint, production build, and all Go package tests passed.
- Go's race detector passed for the match handlers and RPC package.
- Live Pong, Fleet Command, and Arena verification scripts completed successfully.
- Two isolated browser profiles joined private Arena and Fleet Command invitations;
  Arena also rejoined its seat after reload without browser errors.
- The dependency audit reported zero known advisories at validation time.

Build output includes a size warning for the dynamically loaded 3D engine chunk.
The initial page does not load that renderer; the PWA intentionally precaches
practice assets to support offline play.
