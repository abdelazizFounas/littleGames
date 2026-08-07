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
		NorthAim:   north.Aim,
		SouthAim:   south.Aim,
		NorthAlive: north.Alive,
		SouthAlive: south.Alive,
		NorthEpoch: north.SpawnEpoch,
		SouthEpoch: south.SpawnEpoch,
	}
}

// rewoundParts is every part of a target, where it was when the shooter saw it.
//
// Rewinding is refused across a respawn: if the target has been put back at
// their spawn since the frame being read, the shot is judged against where they
// are now. Without that, the ugliest death in the game is possible — being
// killed a beat after reappearing, by a bullet aimed at the corpse.
//
// The aim comes out of the ring along with the body, because the parts are
// oriented by it. Rewinding one and not the other would put a target's feet
// where they were and their arms where they are.
func rewoundParts(state State, target PlayerSim, seat string, back int) []ShotTarget {
	frame := HistoryAt(state, back)

	epoch, body, aim := frame.SouthEpoch, frame.South, frame.SouthAim
	if seat == SeatNorth {
		epoch, body, aim = frame.NorthEpoch, frame.North, frame.NorthAim
	}
	if epoch != target.SpawnEpoch {
		body, aim = target.Body, target.Aim
	}

	parts := HittablePartsOf(PoseOf(body, aim))
	targets := make([]ShotTarget, 0, len(parts))
	for _, part := range parts {
		targets = append(targets, ShotTarget{
			Seat: seat,
			Part: part.Part,
			Box: OrientedBox{
				Centre:  part.Centre,
				Half:    part.Half,
				Right:   part.Right,
				Up:      part.Up,
				Forward: part.Forward,
			},
		})
	}
	return targets
}

// DamageOf is what one hit takes off, decided entirely by where it landed.
func DamageOf(part string) int {
	switch part {
	case PartHead:
		return HeadDamage
	case PartTorso:
		return TorsoDamage
	default:
		return LimbDamage
	}
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
	var firedNorth, firedSouth bool
	damagedNorth, damagedSouth := 0, 0
	scoredNorth, scoredSouth := 0, 0

	for seatIndex, seat := range Seats {
		shooter, input := south, inputs.South
		previousAim := state.South.Aim
		if seat == SeatNorth {
			shooter, input = north, inputs.North
			previousAim = state.North.Aim
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
			targets = rewoundParts(afterMove, target, targetSeat, input.RewindTicks)
		}

		origin := EyePosition(shooter.Body)
		// Where the shot goes rather than where it was pointed. previousAim is
		// the one this seat held before this tick's was latched, which is what
		// makes the turning term a turn rather than a position.
		spread := SpreadOf(shooter.Body, previousAim, shooter.Aim, input.Zoomed)
		line := Deflect(shooter.Aim, spread, SeedOf(nextShotID, seatIndex))
		trace := TraceShot(origin, line, targets)

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

		if trace.HitSeat == "" || trace.HitPart == "" {
			continue
		}

		// A shot that lands is not a kill unless it finishes them, and the
		// score is a count of kills.
		damage := DamageOf(trace.HitPart)
		finished := false
		if trace.HitSeat == SeatNorth {
			damagedNorth += damage
			finished = damagedNorth >= target.Health
		} else {
			damagedSouth += damage
			finished = damagedSouth >= target.Health
		}
		if finished {
			if seat == SeatNorth {
				scoredNorth++
			} else {
				scoredSouth++
			}
		}
	}

	north = settle(north, SeatNorth, damagedNorth, firedNorth, scoredNorth)
	south = settle(south, SeatSouth, damagedSouth, firedSouth, scoredSouth)

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

// settle applies a tick's outcome to one player: damage, death, respawn,
// cooldown, score.
func settle(player PlayerSim, seat string, damage int, wasFired bool, points int) PlayerSim {
	next := player
	next.Score = player.Score + points
	if player.Alive {
		next.Health = player.Health - damage
		if next.Health < 0 {
			next.Health = 0
		}
	}

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

	if next.Health <= 0 && next.Alive {
		next.Alive = false
		next.Health = 0
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
