package arena

import (
	"reflect"
	"testing"
)

// TestArenaMatchesTheVectors is the assertion that keeps the geometry honest.
//
// The box that stops a bullet has to be the box that gets drawn, and the arena
// is written out twice: here, and in the TypeScript the renderer draws from. A
// crate nudged in one language and not the other would otherwise be a silent
// disagreement about where a wall is, discovered by a player standing inside
// one.
func TestArenaMatchesTheVectors(t *testing.T) {
	loaded := loadVectors(t)

	if len(loaded.Arena) != len(ArenaBoxes) {
		t.Fatalf("arena differs: vectors hold %d boxes, this port holds %d",
			len(loaded.Arena), len(ArenaBoxes))
	}
	for index, want := range loaded.Arena {
		if ArenaBoxes[index] != want {
			t.Fatalf("box %d differs\n  got  %+v\n  want %+v", index, ArenaBoxes[index], want)
		}
	}
	if !reflect.DeepEqual(loaded.Spawns, Spawns) {
		t.Fatalf("spawns differ\n  got  %+v\n  want %+v", Spawns, loaded.Spawns)
	}
}

// TestArenaIsTwoExactHalves checks the symmetry is structural rather than
// maintained by hand: the far zone is a reflection of the near one, so there is
// no arrangement in which one player has cover the other does not.
func TestArenaIsTwoExactHalves(t *testing.T) {
	if len(ArenaBoxes)%2 != 0 {
		t.Fatalf("the arena holds an odd number of boxes: %d", len(ArenaBoxes))
	}
	half := len(ArenaBoxes) / 2

	for index, near := range ArenaBoxes[:half] {
		if got, want := ArenaBoxes[half+index], MirrorZ(near); got != want {
			t.Fatalf("box %d is not the reflection of box %d\n  got  %+v\n  want %+v",
				half+index, index, got, want)
		}
	}
}

// TestNothingStandsInTheRavine is what makes "a bullet crosses the gap and a
// player never does" a property of the map rather than a hope.
func TestNothingStandsInTheRavine(t *testing.T) {
	for index, box := range ArenaBoxes {
		if box.MaxZ > -ZoneNearZ && box.MinZ < ZoneNearZ {
			t.Fatalf("box %d leans out over the gap: %+v", index, box)
		}
	}
}

// TestColliderAndOccluderOrder holds the one ordering the whole simulation
// rests on.
//
// Collision resolves against these in slice order and so does the reference; a
// filter preserves source order, and a map would not, because Go randomises map
// iteration by design.
func TestColliderAndOccluderOrder(t *testing.T) {
	colliding := make([]Box, 0, len(ArenaBoxes))
	occluding := make([]Box, 0, len(ArenaBoxes))
	for _, box := range ArenaBoxes {
		if box.BlocksMovement {
			colliding = append(colliding, box)
		}
		if box.BlocksSight {
			occluding = append(occluding, box)
		}
	}

	if !reflect.DeepEqual(Colliders, colliding) {
		t.Fatal("the collider list is not the arena in source order")
	}
	if !reflect.DeepEqual(Occluders, occluding) {
		t.Fatal("the occluder list is not the arena in source order")
	}
	// The clip over each ravine edge stops a body without stopping a bullet,
	// which is the entire layout.
	if len(Occluders) >= len(Colliders) {
		t.Fatalf("nothing blocks movement without blocking sight: %d occluders, %d colliders",
			len(Occluders), len(Colliders))
	}
}

// TestSpawnsAreClear refuses a spawn point inside the scenery. A player put
// inside a crate is pushed out of it by the first tick of collision resolution,
// in whichever direction the resolution order happens to prefer.
func TestSpawnsAreClear(t *testing.T) {
	for _, seat := range Seats {
		standing := BodyBounds(RestingBody(Spawns[seat]))
		for index, collider := range Colliders {
			if overlapsCollider(standing, collider) {
				t.Fatalf("the %s spawn is inside collider %d: %+v", seat, index, collider)
			}
		}
	}

	if Spawns[SeatNorth].Z != -Spawns[SeatSouth].Z {
		t.Fatal("the spawns are not mirror images")
	}
	if Spawns[SeatSouth].Z-Spawns[SeatNorth].Z <= GapDepth {
		t.Fatal("the two spawns are closer together than the gap between the zones")
	}
}
