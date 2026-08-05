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
func deflect(ball Ball, paddleY float64, towards string) Ball {
	offset := clamp((ball.Y-paddleY)/halfPaddle, -1, 1)
	verticalRatio := offset * MaxBounceRatio
	horizontalRatio := math.Sqrt(1 - verticalRatio*verticalRatio)
	speed := math.Min(ball.Speed*BallSpeedGain, BallMaxSpeed)

	horizontalSign := -1.0
	x := rightContact
	if towards == SideRight {
		horizontalSign = 1
		x = leftContact
	}

	return Ball{
		X:     x,
		Y:     ball.Y,
		VX:    horizontalSign * horizontalRatio * speed,
		VY:    verticalRatio * speed,
		Speed: speed,
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

func bounceOffWalls(ball Ball) Ball {
	if ball.Y < BallRadius {
		// Mirror the overshoot back into the field rather than snapping to the
		// wall, so a fast ball keeps the distance it actually travelled.
		ball.Y = BallRadius + (BallRadius - ball.Y)
		ball.VY = -ball.VY
		return ball
	}
	bottom := FieldHeight - BallRadius
	if ball.Y > bottom {
		ball.Y = bottom - (ball.Y - bottom)
		ball.VY = -ball.VY
	}
	return ball
}

// blockedByPaddle reports the deflected ball if a paddle blocked it this tick.
//
// The test is on crossing a plane between the previous position and this one,
// not on overlapping it: at speed the ball covers more than its own diameter in
// a tick, and an overlap test would let it tunnel through the paddle.
func blockedByPaddle(ball Ball, previousX float64, left, right Paddle) (Ball, bool) {
	if ball.VX < 0 && previousX >= leftContact && ball.X <= leftContact {
		if math.Abs(ball.Y-left.Y) <= contactReach {
			return deflect(ball, left.Y, SideRight), true
		}
	}
	if ball.VX > 0 && previousX <= rightContact && ball.X >= rightContact {
		if math.Abs(ball.Y-right.Y) <= contactReach {
			return deflect(ball, right.Y, SideLeft), true
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

	previousX := state.Ball.X
	ball := state.Ball
	ball.X = ball.X + ball.VX*TickSeconds
	ball.Y = ball.Y + ball.VY*TickSeconds
	ball = bounceOffWalls(ball)
	if deflected, hit := blockedByPaddle(ball, previousX, left, right); hit {
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
