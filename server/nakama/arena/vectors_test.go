package arena

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// vectorsPath points at the file the TypeScript reference implementation
// writes. It is read, never copied: a second copy would be free to drift, which
// is the exact failure these vectors exist to prevent.
const vectorsPath = "../../../packages/games/arena/logic/testdata/vectors.json"

// Bits packed into the sixth integer of a player's row.
const (
	flagJump   = 1
	flagCrouch = 2
	flagFire   = 4
	flagZoom   = 8
)

// wireFields is how many integers one player's tick of input occupies.
const wireFields = 7

// observed is the part of the state a checkpoint records.
//
// The history ring is deliberately absent, exactly as in the generator: it is
// fifteen frames of two bodies and would multiply the file by an order of
// magnitude. It is pinned where it matters anyway — the duel scenario resolves
// its shots through the ring, so a ring indexed differently produces different
// hits and the recorded shot events stop matching.
type observed struct {
	Phase      string    `json:"phase"`
	PhaseTicks int       `json:"phaseTicks"`
	Tick       int       `json:"tick"`
	North      PlayerSim `json:"north"`
	South      PlayerSim `json:"south"`
	Winner     string    `json:"winner"`
	NextShotID int       `json:"nextShotId"`
}

func observe(state State) observed {
	return observed{
		Phase:      state.Phase,
		PhaseTicks: state.PhaseTicks,
		Tick:       state.Tick,
		North:      state.North,
		South:      state.South,
		Winner:     state.Winner,
		NextShotID: state.NextShotID,
	}
}

type checkpoint struct {
	Tick  int      `json:"tick"`
	State observed `json:"state"`
}

type shotFrame struct {
	Tick  int         `json:"tick"`
	Shots []ShotEvent `json:"shots"`
}

type scenario struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Inputs      [][]int32    `json:"inputs"`
	Checkpoints []checkpoint `json:"checkpoints"`
	Shots       []shotFrame  `json:"shots"`
}

type vectors struct {
	TickRate  int             `json:"tickRate"`
	Arena     []Box           `json:"arena"`
	Spawns    map[string]Vec3 `json:"spawns"`
	Scenarios []scenario      `json:"scenarios"`
}

func loadVectors(t *testing.T) vectors {
	t.Helper()

	raw, err := os.ReadFile(filepath.Clean(vectorsPath))
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}

	var loaded vectors
	if err := json.Unmarshal(raw, &loaded); err != nil {
		t.Fatalf("decode vectors: %v", err)
	}
	if len(loaded.Scenarios) == 0 {
		t.Fatal("vectors file holds no scenarios")
	}
	return loaded
}

// decodeInput turns one player's seven integers into the intent Step takes,
// exactly as the match handler does with what arrives on the wire.
func decodeInput(row []int32, offset int) Input {
	flags := row[offset+5]
	return Input{
		Move: MoveFromWire(row[offset], row[offset+1]),
		Aim:  NormalizeAim(AimFromWire(row[offset+2], row[offset+3], row[offset+4])),
		Jump:        flags&flagJump != 0,
		Crouch:      flags&flagCrouch != 0,
		Fire:        flags&flagFire != 0,
		Zoomed:      flags&flagZoom != 0,
		RewindTicks: int(row[offset+6]),
	}
}

// TestConformsToReferenceVectors replays the scenarios the TypeScript
// implementation recorded and requires identical results.
//
// The rules exist twice, once here and once in the client, and the client
// predicts its own movement by running its copy ahead of this one. Nothing else
// would catch the two drifting apart, and a drift between prediction and server
// truth is felt in first person as the camera being yanked out from under you.
func TestConformsToReferenceVectors(t *testing.T) {
	loaded := loadVectors(t)

	if loaded.TickRate != TickRate {
		t.Fatalf("tick rate mismatch: vectors %d, server %d", loaded.TickRate, TickRate)
	}

	for _, sc := range loaded.Scenarios {
		t.Run(sc.Name, func(t *testing.T) {
			if len(sc.Checkpoints) == 0 || sc.Checkpoints[0].Tick != 0 {
				t.Fatal("scenario must open with a checkpoint at tick 0")
			}

			state := StartCountdown(NewState(), CountdownTicks)
			if got := observe(state); !reflect.DeepEqual(got, sc.Checkpoints[0].State) {
				t.Fatalf("opening state differs\n  got  %+v\n  want %+v", got, sc.Checkpoints[0].State)
			}

			shotsAt := make(map[int][]ShotEvent, len(sc.Shots))
			for _, frame := range sc.Shots {
				shotsAt[frame.Tick] = frame.Shots
			}

			next := 1
			for index, row := range sc.Inputs {
				if len(row) != wireFields*2 {
					t.Fatalf("tick %d: malformed input row of %d integers", index, len(row))
				}

				var shots []ShotEvent
				state, shots = Step(state, Inputs{
					North: decodeInput(row, 0),
					South: decodeInput(row, wireFields),
				})
				tick := index + 1

				expected := shotsAt[tick]
				if len(shots) != len(expected) || (len(shots) > 0 && !reflect.DeepEqual(shots, expected)) {
					t.Fatalf("shots differ at tick %d\n  got  %+v\n  want %+v", tick, shots, expected)
				}

				if next < len(sc.Checkpoints) && sc.Checkpoints[next].Tick == tick {
					if got := observe(state); !reflect.DeepEqual(got, sc.Checkpoints[next].State) {
						t.Fatalf("diverged at tick %d\n  got  %+v\n  want %+v",
							tick, got, sc.Checkpoints[next].State)
					}
					next++
				}
			}
		})
	}
}

// TestVectorsCoverAFullMatch guards the vectors themselves: a suite that never
// reaches a win, or never fires a shot, would pass while leaving scoring and
// hit registration untested.
func TestVectorsCoverAFullMatch(t *testing.T) {
	loaded := loadVectors(t)

	finished := false
	shooting := 0
	for _, sc := range loaded.Scenarios {
		last := sc.Checkpoints[len(sc.Checkpoints)-1].State
		if last.Phase == PhaseFinished && last.Winner != "" {
			finished = true
		}
		if len(sc.Shots) > 0 {
			shooting++
		}
	}

	if !finished {
		t.Fatal("no scenario plays a match to its end")
	}
	if shooting < 3 {
		t.Fatalf("only %d scenarios fire a shot", shooting)
	}
}
