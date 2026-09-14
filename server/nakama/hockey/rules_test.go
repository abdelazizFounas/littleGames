package hockey

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestSharedPhysicsVectors(t *testing.T) {
	data, err := os.ReadFile("../../../packages/games/hockey/logic/testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct {
		Before State    `json:"before"`
		Inputs [2]Input `json:"inputs"`
		After  State    `json:"after"`
	}
	if err = json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for i, v := range vectors {
		next := Step(v.Before, v.Inputs)
		if next.Phase != v.After.Phase || next.Puck.Owner != v.After.Puck.Owner || next.Scores[0] != v.After.Scores[0] || next.Scores[1] != v.After.Scores[1] || math.Abs(next.Puck.X-v.After.Puck.X) > 1e-7 || math.Abs(next.Puck.Y-v.After.Puck.Y) > 1e-7 {
			t.Fatalf("physics mismatch at vector %d", i)
		}
		for seat, p := range next.Players {
			if p.Down != v.After.Players[seat].Down || p.Swing != v.After.Players[seat].Swing || math.Abs(p.Charge-v.After.Players[seat].Charge) > 1e-7 || math.Abs(p.SwingPower-v.After.Players[seat].SwingPower) > 1e-7 || math.Abs(p.X-v.After.Players[seat].X) > 1e-7 || math.Abs(p.Y-v.After.Players[seat].Y) > 1e-7 {
				t.Fatalf("skater mismatch at vector %d", i)
			}
		}
	}
}
