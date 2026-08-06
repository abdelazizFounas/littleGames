package arena

// ShotEvent is a shot the server resolved, for the client to draw as a tracer.
type ShotEvent struct {
	ID        int    `json:"id"`
	Shooter   string `json:"shooter"`
	Origin    Vec3   `json:"origin"`
	Endpoint  Vec3   `json:"endpoint"`
	HitPlayer bool   `json:"hitPlayer"`
}

func moved(player PlayerSim, input Input) PlayerSim {
	// Shortening the move to unit length is the speed cap, and it happens here
	// rather than in the caller so that it is part of the rules the vectors
	// pin. A dead player's intent is ignored entirely.
	if !player.Alive {
		return player
	}
	player.Body = StepBody(player.Body, MoveIntent{
		Move:   ClampToUnit(input.Move),
		Jump:   input.Jump,
		Crouch: input.Crouch,
	})
	return player
}

func frameOf(north, south PlayerSim) HistoryFrame {
	return HistoryFrame{
		North:      north.Body,
		South:      south.Body,
		NorthAlive: north.Alive,
		SouthAlive: south.Alive,
		NorthEpoch: north.SpawnEpoch,
		SouthEpoch: south.SpawnEpoch,
	}
}

// rewoundBounds is where a target was when the shooter saw it.
//
// Rewinding is refused across a respawn: if the target has been put back at
// their spawn since the frame being read, the shot is judged against where they
// are now. Without that, the ugliest death in the game is possible — being
// killed a beat after reappearing, by a bullet aimed at the corpse.
func rewoundBounds(state State, target PlayerSim, seat string, back int) ShotTarget {
	frame := HistoryAt(state, back)

	epoch, body := frame.SouthEpoch, frame.South
	if seat == SeatNorth {
		epoch, body = frame.NorthEpoch, frame.North
	}
	if epoch != target.SpawnEpoch {
		body = target.Body
	}

	return ShotTarget{Seat: seat, Bounds: BodyBounds(body)}
}

// Step advances the simulation by exactly one tick.
//
// Pure: the same state and the same inputs always produce the same next state,
// which is what lets the server, a client predicting ahead, and a test all
// agree — and what holds this port to the same numbers as the reference.
func Step(state State, inputs Inputs) (State, []ShotEvent) {
	if state.Phase == PhaseWaiting || state.Phase == PhaseFinished {
		return state, nil
	}

	// Aim is latched first and for both seats, whatever the phase: a player
	// turning during the countdown is looking where they will be looking when
	// it ends.
	north, south := state.North, state.South
	north.Aim = NormalizeAim(inputs.North.Aim)
	south.Aim = NormalizeAim(inputs.South.Aim)

	// Bodies move during the countdown too, so a player can take position
	// before the round opens.
	north = moved(north, inputs.North)
	south = moved(south, inputs.South)

	// The ring records where they ended up, before anybody is shot. This is the
	// frame a shooter one tick from now will be rewound into.
	afterMove := state
	afterMove.North, afterMove.South = north, south
	afterMove.HistoryAt = (state.HistoryAt + 1) % len(state.History)
	afterMove.History[afterMove.HistoryAt] = frameOf(north, south)

	if state.Phase == PhaseCountdown {
		next := afterMove
		next.PhaseTicks = state.PhaseTicks - 1
		next.Phase = PhaseCountdown
		if next.PhaseTicks <= 0 {
			next.Phase = PhasePlaying
			next.PhaseTicks = 0
		}
		next.Tick = state.Tick + 1
		return next, nil
	}

	// Both shots are traced against the state as it stood before either of them
	// landed. Resolving one and then the other would hand whichever seat is
	// tested first a free trade, decided by nothing a player can see.
	var shots []ShotEvent
	nextShotID := state.NextShotID
	var killedNorth, killedSouth, firedNorth, firedSouth bool
	scoredNorth, scoredSouth := 0, 0

	for _, seat := range Seats {
		shooter, input := south, inputs.South
		if seat == SeatNorth {
			shooter, input = north, inputs.North
		}
		if !input.Fire || !shooter.Alive || shooter.CooldownTicks > 0 {
			continue
		}

		targetSeat := OpponentOf(seat)
		target := south
		if targetSeat == SeatNorth {
			target = north
		}
		var targets []ShotTarget
		if target.Alive {
			targets = append(targets, rewoundBounds(afterMove, target, targetSeat, input.RewindTicks))
		}

		origin := EyePosition(shooter.Body)
		trace := TraceShot(origin, shooter.Aim, targets)

		shots = append(shots, ShotEvent{
			ID:        nextShotID,
			Shooter:   seat,
			Origin:    origin,
			Endpoint:  trace.Endpoint,
			HitPlayer: trace.HitSeat != "",
		})
		nextShotID++

		if seat == SeatNorth {
			firedNorth = true
		} else {
			firedSouth = true
		}

		switch trace.HitSeat {
		case SeatNorth:
			killedNorth = true
		case SeatSouth:
			killedSouth = true
		}
		if trace.HitSeat != "" {
			if seat == SeatNorth {
				scoredNorth++
			} else {
				scoredSouth++
			}
		}
	}

	north = settle(north, SeatNorth, killedNorth, firedNorth, scoredNorth)
	south = settle(south, SeatSouth, killedSouth, firedSouth, scoredSouth)

	winner := ""
	switch {
	case north.Score >= WinningScore:
		winner = SeatNorth
	case south.Score >= WinningScore:
		winner = SeatSouth
	}

	next := afterMove
	next.North, next.South = north, south
	next.Winner = winner
	next.Phase = PhasePlaying
	if winner != "" {
		next.Phase = PhaseFinished
	}
	next.NextShotID = nextShotID
	next.Tick = state.Tick + 1

	return next, shots
}

// settle applies a tick's outcome to one player: death, respawn, cooldown,
// score.
func settle(player PlayerSim, seat string, wasKilled, wasFired bool, points int) PlayerSim {
	next := player
	next.Score = player.Score + points

	// One short of the constant on the tick a shot goes out, because this tick
	// is the first of the wait rather than the last of the previous one. Set to
	// the constant itself, the gap would be one tick longer than the name
	// promises, and the name is what this port is written against.
	switch {
	case wasFired:
		next.CooldownTicks = FireCooldownTicks - 1
	case player.CooldownTicks > 0:
		next.CooldownTicks = player.CooldownTicks - 1
	default:
		next.CooldownTicks = 0
	}

	if wasKilled && next.Alive {
		next.Alive = false
		next.RespawnTicks = RespawnTicks
		return next
	}

	if !next.Alive {
		remaining := next.RespawnTicks - 1
		if remaining > 0 {
			next.RespawnTicks = remaining
			return next
		}
		score := next.Score
		next = Respawn(next, seat)
		next.Score = score
		return next
	}

	return next
}
