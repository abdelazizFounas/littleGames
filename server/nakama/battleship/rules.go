// Package battleship holds the authoritative Battleship rules.
//
// A port of packages/games/battleship/logic, kept in step with it by the shared
// conformance vectors both replay. TypeScript is the reference: change the
// rules there, regenerate the vectors, then mirror the change here until the Go
// test passes again.
package battleship

const GridSize = 10

// ShipLengths is the fleet, longest first.
var ShipLengths = [...]int{5, 4, 3, 3, 2}

// FleetCells is how many hits sink an entire fleet, and so win the game.
const FleetCells = 5 + 4 + 3 + 3 + 2

// Sides of the board.
const (
	SideA = "a"
	SideB = "b"
)

// Phases a game moves through. The values match the TypeScript ones exactly,
// because both appear in the conformance vectors.
const (
	PhaseWaiting   = "waiting"
	PhasePlacement = "placement"
	PhasePlaying   = "playing"
	PhaseFinished  = "finished"
)

// Orientations, likewise shared with TypeScript.
const (
	Horizontal = "horizontal"
	Vertical   = "vertical"
)

// Shot results.
const (
	ResultMiss = "miss"
	ResultHit  = "hit"
	ResultSunk = "sunk"
)

type Placement struct {
	Row         int    `json:"row"`
	Column      int    `json:"column"`
	Orientation string `json:"orientation"`
}

type Shot struct {
	Row    int `json:"row"`
	Column int `json:"column"`
}

type Board struct {
	Fleet    []Placement `json:"fleet"`
	Ready    bool        `json:"ready"`
	Incoming []Shot      `json:"incoming"`
}

type Boards struct {
	A Board `json:"a"`
	B Board `json:"b"`
}

type State struct {
	Phase  string `json:"phase"`
	Turn   string `json:"turn"`
	Boards Boards `json:"boards"`
	Winner string `json:"winner"`
}

func NewState() State {
	return State{
		Phase: PhaseWaiting,
		// Whoever holds seat A opens. Fixed rather than drawn, so the server and
		// every client agree without exchanging anything.
		Turn: SideA,
		Boards: Boards{
			A: Board{Fleet: []Placement{}, Incoming: []Shot{}},
			B: Board{Fleet: []Placement{}, Incoming: []Shot{}},
		},
	}
}

// StartPlacement moves a waiting game into placement, once both seats are full.
func StartPlacement(state State) State {
	if state.Phase == PhaseWaiting {
		state.Phase = PhasePlacement
	}
	return state
}

func Opponent(side string) string {
	if side == SideA {
		return SideB
	}
	return SideA
}

func (s *State) boardOf(side string) *Board {
	if side == SideA {
		return &s.Boards.A
	}
	return &s.Boards.B
}

func shipLength(index int) int {
	if index < 0 || index >= len(ShipLengths) {
		return 0
	}
	return ShipLengths[index]
}

// CellsOf lists every cell one ship occupies.
func CellsOf(placement Placement, length int) []Shot {
	cells := make([]Shot, 0, length)
	for step := 0; step < length; step++ {
		cell := Shot{Row: placement.Row, Column: placement.Column}
		if placement.Orientation == Vertical {
			cell.Row += step
		} else {
			cell.Column += step
		}
		cells = append(cells, cell)
	}
	return cells
}

// CheckFleet validates a whole fleet at once.
//
// A fleet rather than a ship at a time, because overlap is a property of the
// arrangement and not of any one ship in it.
func CheckFleet(fleet []Placement) string {
	if len(fleet) != len(ShipLengths) {
		return "wrong number of ships"
	}

	taken := make(map[int]bool, FleetCells)
	for index, placement := range fleet {
		for _, cell := range CellsOf(placement, shipLength(index)) {
			if cell.Row < 0 || cell.Row >= GridSize || cell.Column < 0 || cell.Column >= GridSize {
				return "a ship runs off the board"
			}
			key := cell.Row*GridSize + cell.Column
			if taken[key] {
				return "two ships overlap"
			}
			taken[key] = true
		}
	}
	return ""
}

func occupied(fleet []Placement) map[int]bool {
	taken := make(map[int]bool, FleetCells)
	for index, placement := range fleet {
		for _, cell := range CellsOf(placement, shipLength(index)) {
			taken[cell.Row*GridSize+cell.Column] = true
		}
	}
	return taken
}

func isSunk(placement Placement, length int, incoming []Shot) bool {
	struck := make(map[int]bool, len(incoming))
	for _, shot := range incoming {
		struck[shot.Row*GridSize+shot.Column] = true
	}
	for _, cell := range CellsOf(placement, length) {
		if !struck[cell.Row*GridSize+cell.Column] {
			return false
		}
	}
	return true
}

// SunkCount reports how many of a board's ships are on the bottom.
func SunkCount(board Board) int {
	sunk := 0
	for index, placement := range board.Fleet {
		if isSunk(placement, shipLength(index), board.Incoming) {
			sunk++
		}
	}
	return sunk
}

// PlaceFleet confirms one player's fleet, and opens play once both have.
func PlaceFleet(state State, side string, fleet []Placement) (State, string) {
	if state.Phase != PhasePlacement {
		return state, "ships can only be placed before the game starts"
	}
	if state.boardOf(side).Ready {
		return state, "your fleet is already placed"
	}
	if problem := CheckFleet(fleet); problem != "" {
		return state, problem
	}

	board := state.boardOf(side)
	board.Fleet = fleet
	board.Ready = true

	if state.Boards.A.Ready && state.Boards.B.Ready {
		state.Phase = PhasePlaying
	}
	return state, ""
}

// Fire shoots at a cell and reports what was found.
//
// A hit keeps the turn; a miss hands it over. That is the rule most people play
// by, and it is what makes a good guess worth more than the cell it lands on.
func Fire(state State, side string, shot Shot) (State, string, string) {
	if state.Phase != PhasePlaying {
		return state, "", "the game is not being played"
	}
	if state.Turn != side {
		return state, "", "not your turn"
	}
	if shot.Row < 0 || shot.Row >= GridSize || shot.Column < 0 || shot.Column >= GridSize {
		return state, "", "that cell is off the board"
	}

	target := Opponent(side)
	board := state.boardOf(target)

	for _, past := range board.Incoming {
		if past.Row == shot.Row && past.Column == shot.Column {
			// Refused rather than wasted: firing twice at the same square is a
			// misclick, and taking the turn for it would punish the wrong thing.
			return state, "", "that cell has already been fired at"
		}
	}

	board.Incoming = append(board.Incoming, shot)
	cells := occupied(board.Fleet)
	struck := cells[shot.Row*GridSize+shot.Column]

	result := ResultMiss
	if struck {
		result = ResultHit
		for index, placement := range board.Fleet {
			for _, cell := range CellsOf(placement, shipLength(index)) {
				if cell.Row == shot.Row && cell.Column == shot.Column {
					if isSunk(placement, shipLength(index), board.Incoming) {
						result = ResultSunk
					}
					break
				}
			}
		}
	}

	hits := 0
	for _, past := range board.Incoming {
		if cells[past.Row*GridSize+past.Column] {
			hits++
		}
	}

	if struck {
		state.Turn = side
	} else {
		state.Turn = target
	}
	if hits >= FleetCells {
		state.Phase = PhaseFinished
		state.Winner = side
	}

	return state, result, ""
}
