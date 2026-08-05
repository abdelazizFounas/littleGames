package battleship

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
const vectorsPath = "../../../packages/games/battleship/logic/testdata/vectors.json"

type action struct {
	Kind   string      `json:"kind"`
	Side   string      `json:"side"`
	Fleet  []Placement `json:"fleet"`
	Row    int         `json:"row"`
	Column int         `json:"column"`
}

type checkpoint struct {
	Step  int   `json:"step"`
	State State `json:"state"`
}

type vectors struct {
	Actions     []action     `json:"actions"`
	Checkpoints []checkpoint `json:"checkpoints"`
}

func load(t *testing.T) vectors {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(vectorsPath))
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var loaded vectors
	if err := json.Unmarshal(raw, &loaded); err != nil {
		t.Fatalf("decode vectors: %v", err)
	}
	return loaded
}

// TestConformsToReferenceVectors replays the game the TypeScript implementation
// recorded and requires identical results.
//
// The rules exist twice, once here and once in the client. Nothing else would
// catch the two drifting apart.
func TestConformsToReferenceVectors(t *testing.T) {
	loaded := load(t)
	if len(loaded.Checkpoints) == 0 || loaded.Checkpoints[0].Step != 0 {
		t.Fatal("vectors must open with a checkpoint at step 0")
	}

	state := loaded.Checkpoints[0].State
	next := 1

	for step, act := range loaded.Actions {
		if act.Kind == "place" {
			state, _ = PlaceFleet(state, act.Side, act.Fleet)
		} else {
			state, _, _ = Fire(state, act.Side, Shot{Row: act.Row, Column: act.Column})
		}

		if next < len(loaded.Checkpoints) && loaded.Checkpoints[next].Step == step+1 {
			if !reflect.DeepEqual(state, loaded.Checkpoints[next].State) {
				t.Fatalf("diverged at action %d\n  got  %+v\n  want %+v",
					step+1, state, loaded.Checkpoints[next].State)
			}
			next++
		}
	}
}

// TestVectorsReachAWin guards the vectors themselves: a run that never ends
// would pass while leaving victory untested.
func TestVectorsReachAWin(t *testing.T) {
	loaded := load(t)
	final := loaded.Checkpoints[len(loaded.Checkpoints)-1].State
	if final.Phase != PhaseFinished || final.Winner == "" {
		t.Fatalf("no scenario plays to a win: phase %q, winner %q", final.Phase, final.Winner)
	}
}
