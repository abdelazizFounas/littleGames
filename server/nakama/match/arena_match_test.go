package match

import (
	"testing"

	"littlegames.local/nakama/arena"
)

// The queue and the shot counter are the two pieces of this handler that are
// not shared with any other game, and both of them are answers to a client that
// is unreliable, hostile, or simply on a bad connection. Neither is visible in
// the simulation the conformance vectors pin, so they are checked here.

func seatedPlayer(seat string) *arenaPlayer {
	return &arenaPlayer{seat: seat, queue: make([]arenaCommand, 0, arenaQueueDepth)}
}

func stateWith(players ...*arenaPlayer) *arenaState {
	state := &arenaState{players: make(map[string]*arenaPlayer, len(players)), sim: arena.NewState()}
	for index, seated := range players {
		state.players[string(rune('a'+index))] = seated
	}
	return state
}

// TestQueueConsumesOneCommandPerTick is the whole reason this game queues input
// instead of latching the newest like Pong.
//
// Under jitter two commands land in one tick. Latching drops one, so the client
// predicted a step the server never took: for a paddle that is an invisible
// correction, and in first person it is the camera jolting.
func TestQueueConsumesOneCommandPerTick(t *testing.T) {
	seated := seatedPlayer(arena.SeatNorth)
	state := stateWith(seated)

	for step := 1; step <= 3; step++ {
		seated.push(arenaCommand{seq: uint32(step), move: arena.Vec2{X: float64(step)}})
	}

	for step := 1; step <= 3; step++ {
		inputs := state.consume()
		if inputs.North.Move.X != float64(step) {
			t.Fatalf("tick %d executed move %v, want %v", step, inputs.North.Move.X, float64(step))
		}
	}
	if len(seated.queue) != 0 {
		t.Fatalf("%d commands left in the queue", len(seated.queue))
	}
}

// TestStarvedQueueRepeatsTheLastCommand: a player holding a key does not stop
// holding it because a datagram was lost.
func TestStarvedQueueRepeatsTheLastCommand(t *testing.T) {
	seated := seatedPlayer(arena.SeatNorth)
	state := stateWith(seated)

	seated.push(arenaCommand{seq: 1, move: arena.Vec2{X: 1}, jump: true})
	if inputs := state.consume(); inputs.North.Move.X != 1 || !inputs.North.Jump {
		t.Fatalf("the command was not executed: %+v", inputs.North)
	}

	for tick := 0; tick < 5; tick++ {
		inputs := state.consume()
		if inputs.North.Move.X != 1 || !inputs.North.Jump {
			t.Fatalf("the starved tick %d did not repeat the last command: %+v", tick, inputs.North)
		}
	}
}

// TestAFloodedQueueLosesItsOldestCommands bounds how far ahead a client can
// run. Losing the oldest is what keeps the freshest intent ready for the next
// tick.
func TestAFloodedQueueLosesItsOldestCommands(t *testing.T) {
	seated := seatedPlayer(arena.SeatNorth)

	const flood = arenaQueueDepth * 4
	for step := 1; step <= flood; step++ {
		seated.push(arenaCommand{seq: uint32(step)})
	}

	if len(seated.queue) != arenaQueueDepth {
		t.Fatalf("the queue holds %d commands, want %d", len(seated.queue), arenaQueueDepth)
	}
	if first := seated.queue[0].seq; first != flood-arenaQueueDepth+1 {
		t.Fatalf("the queue starts at seq %d, want %d", first, flood-arenaQueueDepth+1)
	}
	if last := seated.queue[len(seated.queue)-1].seq; last != flood {
		t.Fatalf("the newest command was dropped instead of the oldest: seq %d", last)
	}
}

// TestAShotIsClaimedByACounterNotAFlag covers the three things the counter is
// for: it survives a repeat, it survives a duplicate, and it cannot be banked.
func TestAShotIsClaimedByACounterNotAFlag(t *testing.T) {
	seated := seatedPlayer(arena.SeatNorth)
	state := stateWith(seated)

	seated.push(arenaCommand{seq: 1, shotsFired: 1})
	if !state.consume().North.Fire {
		t.Fatal("the first shot did not fire")
	}

	// The queue starves and the same command repeats. A flag would fire again
	// every tick until another command arrived.
	for tick := 0; tick < 3; tick++ {
		if state.consume().North.Fire {
			t.Fatalf("the repeat at tick %d fired a second time", tick)
		}
	}

	// A duplicate delivery re-sends a number the server has already reached.
	seated.push(arenaCommand{seq: 2, shotsFired: 1})
	if state.consume().North.Fire {
		t.Fatal("a duplicated shot counter fired twice")
	}

	// And a client that claims fifty shots at once is credited with one. The
	// counter is caught all the way up rather than one at a time, so there is
	// nothing banked to spend on the ticks that follow.
	seated.push(arenaCommand{seq: 3, shotsFired: 50})
	if !state.consume().North.Fire {
		t.Fatal("a counter that jumped forward fired nothing at all")
	}
	for tick := 0; tick < 3; tick++ {
		if state.consume().North.Fire {
			t.Fatalf("a banked shot was spent at tick %d", tick)
		}
	}
}

// TestAnEmptySeatContributesNothing: a player who has never sent a command must
// not be simulated with whatever a zero value happens to mean. A zero aim in
// particular has no direction to normalise.
func TestAnEmptySeatContributesNothing(t *testing.T) {
	north, south := seatedPlayer(arena.SeatNorth), seatedPlayer(arena.SeatSouth)
	state := stateWith(north, south)

	inputs := state.consume()
	if inputs.North != arena.NoInput || inputs.South != arena.NoInput {
		t.Fatalf("a seat with no commands was not left alone: %+v", inputs)
	}

	south.push(arenaCommand{seq: 1, move: arena.Vec2{Z: 1}})
	inputs = state.consume()
	if inputs.North != arena.NoInput {
		t.Fatalf("the silent seat moved: %+v", inputs.North)
	}
	if inputs.South.Move.Z != 1 {
		t.Fatalf("the seat that sent a command did not: %+v", inputs.South)
	}
}

// TestClampWire pulls a component back inside range rather than throwing the
// frame away: a frame is a whole tick of intent, and dropping one because a
// single component was wide would stop the player dead.
func TestClampWire(t *testing.T) {
	cases := []struct{ value, limit, want int32 }{
		{value: 0, limit: 2048, want: 0},
		{value: 1024, limit: 2048, want: 1024},
		{value: 999999, limit: 2048, want: 2048},
		{value: -999999, limit: 2048, want: -2048},
	}
	for _, one := range cases {
		if got := clampWire(one.value, one.limit); got != one.want {
			t.Fatalf("clampWire(%d, %d) = %d, want %d", one.value, one.limit, got, one.want)
		}
	}
}
