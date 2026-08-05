package pong

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// vectorsPath points at the file the TypeScript reference implementation
// writes. It is read, never copied: a second copy would be free to drift, which
// is the exact failure these vectors exist to prevent.
const vectorsPath = "../../../packages/games/pong/logic/testdata/vectors.json"

type checkpoint struct {
	Tick  int   `json:"tick"`
	State State `json:"state"`
}

type scenario struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Inputs      []string     `json:"inputs"`
	Checkpoints []checkpoint `json:"checkpoints"`
}

type vectors struct {
	TickRate  int        `json:"tickRate"`
	Scenarios []scenario `json:"scenarios"`
}

func decodeInput(symbol byte) PaddleInput {
	return PaddleInput{
		Up:   symbol == 'u' || symbol == 'b',
		Down: symbol == 'd' || symbol == 'b',
	}
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

// TestConformsToReferenceVectors replays the scenarios the TypeScript
// implementation recorded and requires identical results.
//
// The rules exist twice, once here and once in the client. Nothing else would
// catch the two drifting apart, and a drift between client prediction and
// server truth is what makes the ball appear to teleport.
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

			state := sc.Checkpoints[0].State
			next := 1

			for tick, symbols := range sc.Inputs {
				if len(symbols) != 2 {
					t.Fatalf("tick %d: malformed input %q", tick, symbols)
				}

				state = Step(state, Inputs{
					Left:  decodeInput(symbols[0]),
					Right: decodeInput(symbols[1]),
				})

				if next < len(sc.Checkpoints) && sc.Checkpoints[next].Tick == tick+1 {
					if state != sc.Checkpoints[next].State {
						t.Fatalf("diverged at tick %d\n  got  %+v\n  want %+v",
							tick+1, state, sc.Checkpoints[next].State)
					}
					next++
				}
			}
		})
	}
}

// TestVectorsCoverAFullMatch guards the vectors themselves: a suite that never
// reaches the end of a match would pass while leaving scoring untested.
func TestVectorsCoverAFullMatch(t *testing.T) {
	loaded := loadVectors(t)

	for _, sc := range loaded.Scenarios {
		last := sc.Checkpoints[len(sc.Checkpoints)-1].State
		if last.Phase == PhaseFinished && last.Winner != "" {
			return
		}
	}

	t.Fatal("no scenario plays a match to its end")
}
