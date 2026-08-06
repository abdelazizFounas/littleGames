package arena

// The arena, as data.
//
// It lives in the rules rather than in the renderer because the box that stops
// a bullet has to be the box that gets drawn. The conformance vectors carry the
// whole array, and the test beside this file asserts this copy matches it field
// by field — a crate nudged in one language and not the other is the kind of
// divergence that would otherwise hide for weeks.

// Kinds of box. Values match the TypeScript ones exactly: they travel in the
// vectors and the renderer colours by them.
const (
	KindFloor  = "floor"
	KindWall   = "wall"
	KindCrate  = "crate"
	KindPillar = "pillar"
	KindLedge  = "ledge"
	KindClip   = "clip"
)

// Box is an axis-aligned box, which is everything in this game.
//
// Three flags rather than one solid, and the ravine is why: the barrier across
// the front of each zone must stop a player without stopping a bullet, since
// shooting across the gap is the entire game. A single flag cannot say that.
type Box struct {
	MinX float64 `json:"minX"`
	MinY float64 `json:"minY"`
	MinZ float64 `json:"minZ"`
	MaxX float64 `json:"maxX"`
	MaxY float64 `json:"maxY"`
	MaxZ float64 `json:"maxZ"`
	Kind string  `json:"kind"`
	// BlocksMovement stops a body.
	BlocksMovement bool `json:"blocksMovement"`
	// BlocksSight stops a bullet.
	BlocksSight bool `json:"blocksSight"`
	// Visible is whether it is drawn at all.
	Visible bool `json:"visible"`
}

func box(kind string, minX, minY, minZ, maxX, maxY, maxZ float64) Box {
	solid := kind != KindClip
	return Box{
		MinX: minX, MinY: minY, MinZ: minZ,
		MaxX: maxX, MaxY: maxY, MaxZ: maxZ,
		Kind:           kind,
		BlocksMovement: true,
		BlocksSight:    solid,
		Visible:        solid,
	}
}

// MirrorX reflects a box across x = 0, so a zone's own left and right match.
func MirrorX(source Box) Box {
	source.MinX, source.MaxX = -source.MaxX, -source.MinX
	return source
}

// MirrorZ reflects a box across z = 0, which is how the second zone exists at
// all.
//
// Generating the far half rather than typing it out makes the symmetry
// structural: there is no arrangement in which one player has cover the other
// does not, because there is only one arrangement.
func MirrorZ(source Box) Box {
	source.MinZ, source.MaxZ = -source.MaxZ, -source.MinZ
	return source
}

// pairX returns a box and its reflection across the arena's centre line.
func pairX(source Box) []Box {
	return []Box{source, MirrorX(source)}
}

// How high a crate stands: low enough to jump onto, high enough to hide behind.
const (
	crate        float64 = 1
	lowWall      float64 = 0.9
	pillarHeight float64 = 2.4
)

// nearZone is one player's half, at positive z.
//
// Order matters and is load-bearing: collision resolves against these in slice
// order, and the TypeScript reference iterates the identical sequence. Never a
// map — Go randomises map iteration by design, and a divergence there would be
// silent.
func nearZone() []Box {
	boxes := []Box{
		// The ground, one metre thick so a body landing on it has something to
		// stop against rather than a plane to fall through.
		box(KindFloor, -HalfWidth, -1, ZoneNearZ, HalfWidth, 0, ZoneFarZ),

		// The three closed sides.
		box(KindWall, -HalfWidth, 0, ZoneFarZ, HalfWidth, WallHeight, ZoneFarZ+WallThickness),
	}
	boxes = append(boxes, pairX(box(
		KindWall,
		HalfWidth, 0, ZoneNearZ,
		HalfWidth+WallThickness, WallHeight, ZoneFarZ+WallThickness,
	))...)

	boxes = append(boxes,
		// The fourth side is the ravine. A chest-high parapet you can crouch
		// behind and shoot over...
		box(KindLedge, -HalfWidth, 0, ZoneNearZ, HalfWidth, lowWall, ZoneNearZ+0.4),
		// ...and above it, nothing to see and nothing to shoot, but nothing to
		// cross either. This is the whole reason a box carries three flags.
		//
		// Both sit on the zone's own floor rather than leaning out over the
		// drop, so the gap itself holds nothing at all.
		box(KindClip, -HalfWidth, lowWall, ZoneNearZ, HalfWidth, WallHeight, ZoneNearZ+0.4),
	)

	// Cover, mirrored about the centre line so neither flank is the good one.
	boxes = append(boxes, pairX(box(KindCrate, 3.6, 0, ZoneNearZ+1.4, 5.6, crate, ZoneNearZ+3.4))...)
	boxes = append(boxes, pairX(box(KindPillar, 1.2, 0, ZoneNearZ+4.2, 2, pillarHeight, ZoneNearZ+5))...)
	boxes = append(boxes, pairX(box(KindLedge, 6.8, 0, ZoneNearZ+5.2, HalfWidth, lowWall, ZoneNearZ+5.6))...)
	// An awning off each side wall, too low to stand under and high enough to
	// crouch under. Without somewhere it is the only way through, crouching is
	// a smaller hitbox and nothing else — so the lane beneath it is kept clear
	// and it leads somewhere: the flank route to the parapet.
	boxes = append(boxes, pairX(box(KindWall, 6.8, 1.2, ZoneNearZ+1, HalfWidth, 1.8, ZoneNearZ+3))...)
	// One crate dead centre, so the straight line between the two spawns is not
	// a free shot at the moment the round opens.
	boxes = append(boxes, box(KindCrate, -1, 0, ZoneNearZ+2.2, 1, crate, ZoneNearZ+4.2))

	return boxes
}

// ArenaBoxes is every box in the arena, near zone first, then its reflection.
var ArenaBoxes = buildArena()

func buildArena() []Box {
	near := nearZone()
	boxes := make([]Box, 0, len(near)*2)
	boxes = append(boxes, near...)
	for _, source := range near {
		boxes = append(boxes, MirrorZ(source))
	}
	return boxes
}

// Colliders is what a body collides with, in the order it is tested.
var Colliders = filterBoxes(func(candidate Box) bool { return candidate.BlocksMovement })

// Occluders is what a bullet stops against, in the order it is tested.
var Occluders = filterBoxes(func(candidate Box) bool { return candidate.BlocksSight })

func filterBoxes(keep func(Box) bool) []Box {
	kept := make([]Box, 0, len(ArenaBoxes))
	for _, candidate := range ArenaBoxes {
		if keep(candidate) {
			kept = append(kept, candidate)
		}
	}
	return kept
}

// Seats. Which half of the arena a player holds.
const (
	SeatNorth = "north"
	SeatSouth = "south"
)

// Seats is the order both seats are visited in, wherever order could matter.
var Seats = [2]string{SeatNorth, SeatSouth}

// OpponentOf returns the other seat.
func OpponentOf(seat string) string {
	if seat == SeatNorth {
		return SeatSouth
	}
	return SeatNorth
}

// Spawns is the feet position each seat returns to: at the back, facing across
// the gap.
var Spawns = map[string]Vec3{
	SeatSouth: {X: 0, Y: 0, Z: ZoneFarZ - 1.5},
	SeatNorth: {X: 0, Y: 0, Z: -(ZoneFarZ - 1.5)},
}

// SpawnAim is which way a seat looks when it spawns: at the other one.
var SpawnAim = map[string]Vec3{
	SeatSouth: {X: 0, Y: 0, Z: -1},
	SeatNorth: {X: 0, Y: 0, Z: 1},
}
