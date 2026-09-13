package match

import (
	"littlegames.local/nakama/battleship"
	"testing"
)

func TestRevealedShipsOnlyIncludesFullySunkPlacements(t *testing.T) {
	board := battleship.Board{Fleet: []battleship.Placement{
		{Row: 0, Column: 0, Orientation: battleship.Horizontal},
		{Row: 1, Column: 0, Orientation: battleship.Vertical},
	}}
	if len(revealedShips(board)) != 0 {
		t.Fatal("untouched fleet disclosed")
	}
	for column := 0; column < 4; column++ {
		board.Incoming = append(board.Incoming, battleship.Shot{Row: 0, Column: column})
	}
	// A touching ship is partially hit; neither placement is public yet.
	board.Incoming = append(board.Incoming, battleship.Shot{Row: 1, Column: 0})
	if len(revealedShips(board)) != 0 {
		t.Fatal("partially hit fleet disclosed")
	}
	board.Incoming = append(board.Incoming, battleship.Shot{Row: 0, Column: 4})
	revealed := revealedShips(board)
	if len(revealed) != 1 || revealed[0].Index != 0 || revealed[0].Placement.Row != 0 || revealed[0].Placement.Column != 0 {
		t.Fatalf("expected only the sunk carrier, got %v", revealed)
	}
	// Rebuilding a snapshot must retain the wreck without revealing its neighbor.
	if len(revealedShips(board)) != 1 {
		t.Fatal("reconnect lost a revealed ship")
	}
	for row := 2; row < 5; row++ {
		board.Incoming = append(board.Incoming, battleship.Shot{Row: row, Column: 0})
	}
	if len(revealedShips(board)) != 2 {
		t.Fatal("second sunk ship not revealed")
	}
}
