package artillery

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestConformance(t *testing.T) {
	data, err := os.ReadFile("../../../packages/games/artillery/logic/testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct {
		Before State  `json:"before"`
		Player int    `json:"player"`
		Action Action `json:"action"`
		After  State  `json:"after"`
	}
	if err = json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for index, v := range vectors {
		next, err := Act(v.Before, v.Player, v.Action)
		if err != nil {
			t.Fatalf("vector %d: %v", index, err)
		}
		if next.Phase != v.After.Phase || next.Turn != v.After.Turn || next.Round != v.After.Round || next.Wind != v.After.Wind || next.Scores[0] != v.After.Scores[0] || next.Scores[1] != v.After.Scores[1] || next.Tanks[0] != v.After.Tanks[0] || next.Tanks[1] != v.After.Tanks[1] {
			t.Fatalf("vector %d state mismatch", index)
		}
		if next.LastShot != nil {
			if math.Abs(next.LastShot.Impact.X-v.After.LastShot.Impact.X) > 1e-6 || math.Abs(next.LastShot.Impact.Y-v.After.LastShot.Impact.Y) > 1e-6 {
				t.Fatalf("vector %d impact mismatch", index)
			}
		}
	}
}
func TestInvalidCommandsDoNotMutateState(t *testing.T) {
	s := New(DefaultOptions)
	s, _ = Act(s, 0, Action{Type: "ready"})
	s, _ = Act(s, 1, Action{Type: "ready"})
	for _, a := range []Action{{Type: "fire", Angle: math.NaN(), Power: 70, Weapon: "shell"}, {Type: "fire", Angle: 45, Power: 101, Weapon: "shell"}, {Type: "fire", Angle: 45, Power: 70, Weapon: "invalid"}} {
		next, err := Act(s, 0, a)
		if err == nil || next.Revision != s.Revision {
			t.Fatal("invalid command accepted")
		}
	}
}
