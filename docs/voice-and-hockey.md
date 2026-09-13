# Match voice, Ice Clash, and Pocket Artillery

All five games support online play and Easy, Hard, and Extra Hard practice. Practice runs locally and becomes available offline after the service worker finishes caching the app. Online matches and voice require a connection.

## Match voice

Choose **Join voice** in an active match and allow microphone access. **Mute microphone** changes the local audio tracks' `enabled` flag. Each remote player has an independent mute control on their HTML audio element. **Leave voice**, leaving the match page, or signing out stops local tracks, detaches remote streams, closes media calls, and destroys the PeerJS instance. Canceling a pending microphone prompt also stops a stream if permission arrives later. Browsers that block autoplay display **Enable audio**.

PeerJS 1.5.5 connects through a self-hosted PeerServer 1.0.2 at `/peerjs`. Caddy proxies its HTTPS and WebSocket traffic; the container has no public port in production. Vite proxies the same path locally. The client uses exactly:

```js
config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
```

Nakama's authenticated `voice_room` RPC verifies that the caller currently occupies a live seat in the requested match. The match handler receives a process-authenticated internal request, so a public lobby/password signal cannot impersonate a voice member. Random PeerJS identities are only distributed to members of that match. A three-second heartbeat refreshes membership; abandoned entries expire after fifteen seconds. A deterministic ordering of peer IDs selects one caller for each pair, supporting a full mesh without duplicate calls. The current games have two seats; the voice membership and mesh also support larger rosters when a future game supports them.

Audio travels directly between players. The application does not record audio. Google STUN helps discover network routes; it does not relay the audio. **STUN alone cannot traverse every network**, especially restrictive or symmetric NATs. Such connections show an error; a TURN relay would be necessary to support those networks. This release intentionally uses the requested Google STUN configuration. HTTPS is required outside localhost.

The production microphone policy is `microphone=(self)`. Media streams are permitted by the CSP; signaling and media requests are excluded from the offline navigation fallback. These settings are in `server/docker/Caddyfile.prod` and `packages/ui/vite.config.ts`.

References: [PeerJS Peer API](https://peerjs.com/client/api/peer), [media calls](https://peerjs.com/client/api/media-connection), [NAT limitations](https://peerjs.com/client/faq), [PeerServer configuration](https://github.com/peers/peerjs-server).

## Ice Clash

Ice Clash is a one-on-one arcade hockey game with automatic goalkeepers. Use WASD, ZQSD, or the arrow keys to skate; Space shoots in the direction the player faces. On touchscreens, drag the skate control and tap Shoot. The first player to five goals wins. Each goal returns the players and puck to a center faceoff.

The simulation advances in fixed 1/60-second steps. Skater acceleration is gradual, velocity retains 0.96 per step, and reversing direction takes time. Free pucks retain 0.99 velocity and rebound from the boards with 0.85 restitution. Possession follows a spring-like offset in front of the skater. Physical overlap transfers possession, with a short protection interval to prevent repeated stealing during the same collision. Goalkeepers track the puck along a fixed vertical axis.

Practice bots differ in pursuit speed, interception prediction, and shot cadence. Online games simulate authoritatively in Go at 60 ticks per second and broadcast 30 snapshots per second. The canvas renders with `requestAnimationFrame` and interpolates received positions. Rendering targets 60 FPS; actual frame rate depends on the device and browser. A disconnected seat is reserved for sixty seconds; the opponent then wins by forfeit. Practice can pause, restart, and change difficulty without a server.

Rules live in `packages/games/hockey/logic` and `server/nakama/hockey`. Shared test vectors compare the two implementations, including full-match scoring, movement, possession, and faceoff transitions.

## Pocket Artillery and Rift Arena

Pocket Artillery includes Amber Mesa, Alpine Echo, and a lower-gravity lunar battlefield; configurable wind, armor, turn timer, and best-of rounds; standard, heavy, and scatter shells; one shield per round; a launch guide; flight and impact animations; and optional synthesized sound. Online configuration is host-controlled and both players ready up. The server validates revisions, resolves trajectories, expires turns, and handles reconnects and forfeits. Shared trajectory fixtures check browser/server agreement.

Arena settings now work in online and practice play, including fullscreen. On mobile, **View control** selects a rate-based joystick or a relative touchpad. The touchpad stops turning when the finger stops moving. Opening settings releases held input, and practice pauses while settings are open. Preferences persist locally; signed-in online settings also use the existing account synchronization.

## Validation

```sh
pnpm check
# Go tests can run inside the matching Nakama plugin-builder image.
NAKAMA_INTEGRATION=1 NAKAMA_SOCKET_SERVER_KEY=your-test-key pnpm test:e2e
pnpm test:production
```

The integration suite requires isolated Nakama and PeerServer instances accessible through the Vite development proxies. It uses two independent browser profiles to verify authoritative gameplay, seat restoration, real WebRTC audio, local and remote mute, leaving, rejoining, and navigation cleanup. Chromium's fake microphone provides deterministic test audio; this does not replace testing calls across different real-world networks or mobile Safari hardware.
