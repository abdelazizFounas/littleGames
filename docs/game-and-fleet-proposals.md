# Next games and Fleet Command upgrades

Status: proposals only. No game or ability in this document is implemented. All names are working titles.

## Direction

Build short, instantly understandable games for friends: a readable arena, one central skill, a rematch in seconds, and useful solo practice. Start with two-player games that fit the existing lobby and authoritative server. Favor native canvas, SVG, and simple 3D geometry over asset-heavy worlds.

Three-player games are a deliberate platform extension: make capacity a per-game setting, adapt lobby seating and ready states, define disconnect/forfeit rules, and test three independent clients. A third player is not just an extra character on screen. The complexity below covers each game after that shared work.

## Recommended game shortlist

| Priority | Working title | View | Players | Core loop | Bounded first version | Relative effort |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pocket Artillery | 2D side view | 2 or 3 | Take turns choosing angle and power to hit rival tanks. | One fixed terrain profile, three tank positions, one projectile type, simple wind, no destructible terrain. | Low–medium; deterministic projectile simulation and turn handling. |
| 2 | Neon Trails | 2D top-down | 2 or 3 | Steer continuously, leave a trail, and survive without colliding. | One grid, four directions, simultaneous elimination resolution, first to three rounds. | Low–medium; reuse authoritative input and snapshots. |
| 3 | Reactor Crew | 2D top-down | 2 or 3 cooperative | Carry color-coded energy cells to repair a shared reactor before time expires. | One room, three stations, a carry/interact action, seeded tasks, no enemies. | Medium; shared objectives and interaction arbitration. |
| 4 | Triangle Rally | 2D arena | Exactly 3 | Protect one side of a triangular court with a paddle. | One ball, three straight paddles, equal lives, surviving two players retain their sides while the empty side becomes a wall. | Medium; extends Pong with corner collision and elimination rules. |
| 5 | Blast Grid | 2D top-down | 2 or 3 | Place timed bombs, open routes, and catch opponents in cross-shaped blasts. | One tile arena, one bomb per player, fixed blast range, destructible crates, no pickups initially. | Medium; chain reactions, simultaneous damage, and timing need careful tests. |
| 6 | Orbit Bump | 3D fixed overhead camera | 2 or 3 | Dash into rivals to knock them off a circular platform. | Kinematic discs, one dash with a cooldown, simple push impulses, shrinking boundary, no full physics engine. | Medium; tune server reconciliation and simultaneous impacts. |
| 7 | Beacon Rush | 3D fixed isometric camera | 2 or 3 | Race between visible beacons in a compact obstacle course. | One authored map, running and a short dash, no jumping or moving platforms, first to five checkpoints. | Medium; reuse movement foundations while keeping camera and collision simple. |
| 8 | Lockstep Duel | 2D board | 2 or 3 | Secretly select move, guard, or strike; reveal everyone's choice together. | Small hex board, three health, short planning timer, explicit simultaneous-resolution rules, no cards or inventory. | Low–medium; server-held orders and clear resolution animation. |

Recommended order: **Pocket Artillery → Neon Trails → Orbit Bump**. This adds a turn-based precision game, a fast survival game, and a visually distinct 3D game without introducing large worlds or expensive asset pipelines. Prototype with two players first; unlock three-player support once the shared lobby work is verified.

For every approved game, include keyboard controls, touch controls where practical, rematch flow, disconnect handling, and Easy / Hard / Extra Hard practice with actual behavioral differences. Bots must operate on the same information available to human players.

## Fleet Command: choose an ultimate before deployment

Create an optional **Tactical** ruleset alongside Classic. Each commander chooses one ability before locking their fleet. Both selections become visible when deployment ends, allowing anticipation. Everyone has the same choices; there are no paid advantages or persistent power upgrades.

For the first version, grant exactly one activation per match, available from the player's third normal turn. Activating an ultimate **always ends that turn**, including damage-dealing abilities, so there is no ambiguous interaction with the normal extra turn on a hit. Show a targeting preview, a confirmation button, and an explicit description of the cost. Do not allow activations while another action is resolving.

### First three candidates

| Ultimate | Target and effect | Tradeoff and counterplay | Implementation notes |
| --- | --- | --- | --- |
| Sonar Sweep | Select a 2×2 area; receive the count of unhit enemy ship cells in that area. No exact coordinates or orientations. | Sacrifice the current attack for information. Spread deployment reduces the value of a single scan. | Server computes the count from hidden state; only the activating player receives it. Announce the scanned area to both players. Reject areas extending outside the board. |
| Twin Torpedo | Select two orthogonally adjacent, untried cells; fire at both in one activation. | A small damage burst with a fixed shape. The turn ends even if either shot hits. | Resolve as one atomic action in a defined order. Stop damage if the first torpedo ends the match. Reveal only ships actually sunk and animate each resolved shot. |
| Bearing Analysis | Select an existing hit on an afloat ship; reveal whether that ship runs horizontally or vertically. | Useful only after earning a hit; gives no length, starting coordinate, or other ship location. | Validate the hit against the authoritative board. Share the result only with its user. Reject sunk ships and misses without consuming the ability. |

Start playtesting with these three. Sonar is the safest first prototype because it changes information rather than damage or fleet state. Tune activation timing, scan size, and target restrictions using win rate and pick rate; do not assume the initial numbers are balanced.

### More ambitious candidates, for later evaluation

- **Smoke Screen:** conceal the result of the opponent's next ordinary shot until the start of their following turn. This needs a precise rule for extra turns, delayed sunk announcements, accessibility, and reconnects. Higher complexity than its visual effect suggests.
- **Emergency Repairs:** restore one damaged cell of an afloat ship. This changes the meaning of shot history and repeated targeting; it requires a revised board model and explicit repair markers. Do not retrofit it into immutable hit history.
- **Silent Relocation:** reposition one completely untouched ship once, with placement validation. Previously fired cells must remain ineligible destinations so old misses never become misleading. Requires an expanded hidden-state model and careful replay rules.
- **Decoy Signal:** add a temporary decoy to sonar reports. Consider only after information abilities prove enjoyable; otherwise it can make an already uncertain game feel arbitrary.

### Rules and engineering required before any ultimate ships

1. Define a versioned ruleset on the lobby and match. Classic retains its existing actions and behavior.
2. Store selection, unlock state, and consumption on the server. Deduplicate retries and reject out-of-turn, unavailable, or invalid activations atomically.
3. Send private information only to its owner. Spectators and public replays must never expose afloat fleets or private scan results.
4. Persist used abilities and resolved results through reconnect. Animation is a presentation of accepted actions, never the source of damage.
5. Teach all practice difficulties the same legal actions. Increase planning quality without granting hidden information.
6. Test turn endings, the last surviving ship, simultaneous damage inside one action, invalid targets, disconnects, and mixed client versions.

## Other ways to elevate Fleet Command

| Idea | Player benefit | Scope recommendation |
| --- | --- | --- |
| Cinematic audio | Distinct launch, splash, hull impact, sinking, and victory cues make each shot satisfying. | Short synthesized or licensed sounds, user-controlled volume, mute persistence, no autoplay before interaction. |
| Ocean themes | Arctic dusk, tropical night, and stormy Atlantic change the atmosphere. | Cosmetic palettes and restrained particles; preserve grid contrast and reduced-motion support. |
| Captain loadout cards | A strong identity for the chosen ultimate with a readable readiness indicator. | One compact pre-match choice and a single battle button; no progression system initially. |
| Tactical notebook | Mark suspected ship cells and record sonar counts without firing. | Local private annotations, touch-friendly, cleared or restored predictably on restart/reconnect. |
| Final battle report | Show accuracy, ships sunk, turns played, and a concise timeline. | Reveal both full fleets only after the match is over; separate final-only data from live snapshots. |
| Private rematch | Offer another round with the same opponent and fresh deployment. | Both players opt in; support leaving cleanly and reselecting abilities in Tactical mode. |
| Captain challenges | Practice scenarios such as finishing a damaged fleet or using limited ammunition. | Fixed small scenarios, three difficulty levels, local progress, no global ranking initially. |
| Weather as atmosphere | Animated cloud shadows, light rain, distant lightning, and subtle wakes. | Cosmetic only first. Gameplay weather would complicate fairness, visibility, and balancing. |

## Suggested delivery sequence if approved later

1. Tactical notebook, audio controls, and final battle report.
2. A Classic/Tactical switch and Sonar Sweep in practice, with fairness and reconnect tests.
3. Twin Torpedo and Bearing Analysis, followed by online playtesting with all three choices.
4. One new two-player game from the shortlist.
5. Shared three-player lobby support and one intentionally three-player release.

This document is a decision aid, not a promise to implement all features. Approve and test one small, complete addition at a time.
