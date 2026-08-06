package pong

import "math"

const (
	halfPaddle  float64 = PaddleHeight / 2
	paddleMinY  float64 = halfPaddle
	paddleMaxY  float64 = FieldHeight - halfPaddle
	leftContact float64 = LeftPaddleX + PaddleWidth/2 + BallRadius
	// rightContact is the plane the ball's centre must reach to be blocked on
	// the right.
	rightContact float64 = RightPaddleX - PaddleWidth/2 - BallRadius
	// contactReach is a paddle's vertical reach against the ball's centre.
	contactReach float64 = halfPaddle + BallRadius
)

func clamp(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func movePaddle(paddle Paddle, input PaddleInput) Paddle {
	direction := 0.0
	if input.Down {
		direction += 1
	}
	if input.Up {
		direction -= 1
	}
	if direction == 0 {
		return paddle
	}
	moved := paddle.Y + direction*PaddleSpeed*TickSeconds
	return Paddle{Y: clamp(moved, paddleMinY, paddleMaxY)}
}

// deflect rebuilds the velocity after a paddle hit.
//
// The horizontal component comes from a square root rather than a cosine
// because square root is exactly rounded by IEEE-754 in both languages, while
// trigonometry is not, and this has to agree with the TypeScript reference to
// the last bit.
//
// Both positions are the ones held at the moment of contact, not at the end of
// the tick the contact happened in.
func deflect(contactY, paddleY, speed float64, towards string) Ball {
	offset := clamp((contactY-paddleY)/halfPaddle, -1, 1)
	verticalRatio := offset * MaxBounceRatio
	horizontalRatio := math.Sqrt(1 - verticalRatio*verticalRatio)
	next := math.Min(speed*BallSpeedGain, BallMaxSpeed)

	horizontalSign := -1.0
	x := rightContact
	if towards == SideRight {
		horizontalSign = 1
		x = leftContact
	}

	return Ball{
		X:     x,
		Y:     contactY,
		VX:    horizontalSign * horizontalRatio * next,
		VY:    verticalRatio * next,
		Speed: next,
	}
}

func serve(pointsPlayed int, towards string) Ball {
	ratio := ServeVerticalRatios[pointsPlayed%len(ServeVerticalRatios)]
	horizontalRatio := math.Sqrt(1 - ratio*ratio)
	horizontalSign := -1.0
	if towards == SideRight {
		horizontalSign = 1
	}

	return Ball{
		X:     FieldWidth / 2,
		Y:     FieldHeight / 2,
		VX:    horizontalSign * horizontalRatio * BallInitialSpeed,
		VY:    ratio * BallInitialSpeed,
		Speed: BallInitialSpeed,
	}
}

// foldIntoField mirrors a y coordinate back inside the field.
//
// The overshoot is reflected rather than snapped to the wall, so a fast ball
// keeps the distance it actually travelled. One reflection is enough: at the
// ball's top speed a tick carries it a twenty-fifth of the field's height, so it
// cannot reach one wall and then the other.
func foldIntoField(y float64) float64 {
	if y < BallRadius {
		return BallRadius + (BallRadius - y)
	}
	bottom := FieldHeight - BallRadius
	if y > bottom {
		return bottom - (y - bottom)
	}
	return y
}

func bounceOffWalls(ball Ball) Ball {
	folded := foldIntoField(ball.Y)
	if folded == ball.Y {
		return ball
	}
	ball.Y = folded
	ball.VY = -ball.VY
	return ball
}

// crossingFraction reports where in the tick the ball's centre reached a plane.
//
// Only asked once the two ends of the tick are known to straddle the plane, so
// the travel cannot be zero and the answer is always within [0, 1].
func crossingFraction(previousX, x, plane float64) float64 {
	return (plane - previousX) / (x - previousX)
}

// blockedByPaddle reports the deflected ball if a paddle blocked it this tick.
//
// The test is on crossing a plane between the previous position and this one,
// not on overlapping it: at speed the ball covers more than its own diameter in
// a tick, and an overlap test would let it tunnel through the paddle.
//
// Crossing the plane is only half the question, though. The other half is
// whether the paddle was in front of the ball at that moment, and the moment is
// somewhere inside the tick rather than at the end of it. At full speed and the
// steepest angle the ball climbs twenty-four units in one tick — nearly half the
// paddle's reach — and the paddle itself travels fourteen. Asking where either
// of them ended up is how a ball goes through solid material, and how one that
// was never in reach gets returned.
//
// So both are wound back to the instant of contact. Both move at a constant
// velocity across the tick, so that is one multiplication each and no
// approximation.
func blockedByPaddle(
	ball, previous Ball,
	previousLeft, previousRight, left, right Paddle,
) (Ball, bool) {
	if ball.VX < 0 && previous.X >= leftContact && ball.X <= leftContact {
		at := crossingFraction(previous.X, ball.X, leftContact)
		// From the pre-bounce velocity, then folded: the ball may have met a
		// wall on its way to the paddle, and the trajectory is a straight line
		// only until it does.
		contactY := foldIntoField(previous.Y + previous.VY*TickSeconds*at)
		paddleY := previousLeft.Y + (left.Y-previousLeft.Y)*at
		if math.Abs(contactY-paddleY) <= contactReach {
			return deflect(contactY, paddleY, ball.Speed, SideRight), true
		}
	}
	if ball.VX > 0 && previous.X <= rightContact && ball.X >= rightContact {
		at := crossingFraction(previous.X, ball.X, rightContact)
		contactY := foldIntoField(previous.Y + previous.VY*TickSeconds*at)
		paddleY := previousRight.Y + (right.Y-previousRight.Y)*at
		if math.Abs(contactY-paddleY) <= contactReach {
			return deflect(contactY, paddleY, ball.Speed, SideLeft), true
		}
	}
	return ball, false
}

// concededSide reports which side let the ball out, if any.
func concededSide(ball Ball) string {
	if ball.X+BallRadius < 0 {
		return SideLeft
	}
	if ball.X-BallRadius > FieldWidth {
		return SideRight
	}
	return ""
}

// Step advances the simulation by exactly one tick.
//
// Pure: the same state and inputs always produce the same next state, which is
// what lets the server, a client predicting ahead, and a test all agree.
func Step(state State, inputs Inputs) State {
	if state.Phase == PhaseWaiting || state.Phase == PhaseFinished {
		return state
	}

	// Paddles answer during the countdown and the pause after a point too, so a
	// player can take position before the serve.
	previousLeft := state.Left
	previousRight := state.Right
	left := movePaddle(state.Left, inputs.Left)
	right := movePaddle(state.Right, inputs.Right)
	state.Left = left
	state.Right = right

	if state.Phase == PhaseCountdown || state.Phase == PhasePointScored {
		state.PhaseTicks--
		if state.PhaseTicks > 0 {
			return state
		}
		state.Phase = PhasePlaying
		state.PhaseTicks = 0
		state.Ball = serve(state.PointsPlayed, state.ServeTowards)
		return state
	}

	previous := state.Ball
	ball := state.Ball
	ball.X = ball.X + ball.VX*TickSeconds
	ball.Y = ball.Y + ball.VY*TickSeconds
	ball = bounceOffWalls(ball)
	if deflected, hit := blockedByPaddle(
		ball, previous, previousLeft, previousRight, left, right,
	); hit {
		ball = deflected
	}
	state.Ball = ball

	conceded := concededSide(ball)
	if conceded == "" {
		return state
	}

	if conceded == SideLeft {
		state.Score.Right++
	} else {
		state.Score.Left++
	}
	state.PointsPlayed++

	winner := ""
	if state.Score.Left >= WinningScore {
		winner = SideLeft
	} else if state.Score.Right >= WinningScore {
		winner = SideRight
	}

	// The ball rests at the centre between points, so nothing is in flight
	// while the score is being read.
	state.Ball = Ball{X: FieldWidth / 2, Y: FieldHeight / 2, VX: 0, VY: 0, Speed: BallInitialSpeed}
	// The player who conceded receives the next serve.
	state.ServeTowards = conceded
	state.Winner = winner
	if winner == "" {
		state.Phase = PhasePointScored
		state.PhaseTicks = PointPauseTicks
	} else {
		state.Phase = PhaseFinished
		state.PhaseTicks = 0
	}

	return state
}
