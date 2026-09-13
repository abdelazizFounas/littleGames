package hockey

import "math"

const TickRate = 60
const WinScore = 5

type Skater struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	VX       float64 `json:"vx"`
	VY       float64 `json:"vy"`
	DX       float64 `json:"dx"`
	DY       float64 `json:"dy"`
	Cooldown int     `json:"cooldown"`
}
type Puck struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	VX    float64 `json:"vx"`
	VY    float64 `json:"vy"`
	Owner int     `json:"owner"`
	Lock  int     `json:"lock"`
}
type State struct {
	Tick      int       `json:"tick"`
	Phase     string    `json:"phase"`
	Countdown int       `json:"countdown"`
	Players   []Skater  `json:"players"`
	Puck      Puck      `json:"puck"`
	Goalies   []float64 `json:"goalies"`
	Scores    []int     `json:"scores"`
	Winner    int       `json:"winner"`
	Goal      int       `json:"goal"`
}
type Input struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Shoot bool    `json:"shoot"`
}

func New() State {
	return State{Phase: "waiting", Countdown: 90, Players: []Skater{{X: 340, Y: 300, DX: 1}, {X: 660, Y: 300, DX: -1}}, Puck: Puck{X: 500, Y: 300, Owner: -1}, Goalies: []float64{300, 300}, Scores: []int{0, 0}, Winner: -1, Goal: -1}
}
func Start(s State) State             { s.Phase = "faceoff"; s.Countdown = 90; return s }
func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
func Step(state State, inputs [2]Input) State {
	if state.Phase == "waiting" || state.Phase == "finished" {
		return state
	}
	s := state
	s.Tick++
	s.Players = append([]Skater(nil), state.Players...)
	s.Goalies = append([]float64(nil), state.Goalies...)
	s.Scores = append([]int(nil), state.Scores...)
	if s.Phase == "faceoff" {
		s.Countdown--
		if s.Countdown <= 0 {
			s.Phase = "playing"
		}
		return s
	}
	for i := 0; i < 2; i++ {
		p := &s.Players[i]
		in := inputs[i]
		x, y := clamp(in.X, -1, 1), clamp(in.Y, -1, 1)
		if math.IsNaN(x) || math.IsInf(x, 0) {
			x = 0
		}
		if math.IsNaN(y) || math.IsInf(y, 0) {
			y = 0
		}
		length := math.Hypot(x, y)
		if length > 1 {
			x /= length
			y /= length
		}
		p.VX = (p.VX + x*.42) * .96
		p.VY = (p.VY + y*.42) * .96
		speed := math.Hypot(p.VX, p.VY)
		if speed > 5.5 {
			p.VX = p.VX / speed * 5.5
			p.VY = p.VY / speed * 5.5
		}
		p.X = clamp(p.X+p.VX, 58, 942)
		p.Y = clamp(p.Y+p.VY, 68, 532)
		if p.X == 58 || p.X == 942 {
			p.VX *= .4
		}
		if p.Y == 68 || p.Y == 532 {
			p.VY *= .4
		}
		if length > .05 {
			p.DX = x / math.Max(length, 1)
			p.DY = y / math.Max(length, 1)
			f := math.Hypot(p.DX, p.DY)
			if f > 0 {
				p.DX /= f
				p.DY /= f
			}
		}
		p.Cooldown = max(0, p.Cooldown-1)
	}
	puck := &s.Puck
	puck.Lock = max(0, puck.Lock-1)
	a, b := &s.Players[0], &s.Players[1]
	dx, dy := b.X-a.X, b.Y-a.Y
	distance := math.Hypot(dx, dy)
	if distance < 36 && puck.Owner >= 0 && puck.Lock == 0 {
		puck.Owner = 1 - puck.Owner
		puck.Lock = 25
	}
	if distance < 36 {
		nx, ny := 1., 0.
		if distance > .001 {
			nx = dx / distance
			ny = dy / distance
		}
		overlap := (36 - distance) / 2
		a.X -= nx * overlap
		a.Y -= ny * overlap
		b.X += nx * overlap
		b.Y += ny * overlap
		a.VX -= nx * .3
		a.VY -= ny * .3
		b.VX += nx * .3
		b.VY += ny * .3
	}
	for i := 0; i < 2; i++ {
		p := &s.Players[i]
		if inputs[i].Shoot && p.Cooldown == 0 {
			p.Cooldown = 24
			if puck.Owner == i || puck.Owner == -1 && math.Hypot(puck.X-p.X, puck.Y-p.Y) < 47 {
				puck.Owner = -1
				puck.Lock = 18
				puck.X = p.X + p.DX*33
				puck.Y = p.Y + p.DY*33
				puck.VX = p.DX*16 + p.VX*.4
				puck.VY = p.DY*16 + p.VY*.4
			}
		}
	}
	if puck.Owner >= 0 {
		owner := s.Players[puck.Owner]
		tx, ty := owner.X+owner.DX*29, owner.Y+owner.DY*29
		puck.VX = (tx - puck.X) * .36
		puck.VY = (ty - puck.Y) * .36
		puck.X += puck.VX
		puck.Y += puck.VY
	} else {
		puck.VX *= .99
		puck.VY *= .99
		puck.X += puck.VX
		puck.Y += puck.VY
	}
	for i := 0; i < 2; i++ {
		gy := s.Goalies[i]
		s.Goalies[i] = clamp(gy+clamp(puck.Y-gy, -2.1, 2.1), 236, 364)
		gx := 76.
		if i == 1 {
			gx = 924
		}
		dy := puck.Y - s.Goalies[i]
		dx := puck.X - gx
		distance := math.Hypot(dx, dy)
		if distance < 29 {
			nx, ny := 1., 0.
			if i == 1 {
				nx = -1
			}
			if distance > .001 {
				nx = dx / distance
				ny = dy / distance
			}
			dot := puck.VX*nx + puck.VY*ny
			puck.X = gx + nx*30
			puck.Y = s.Goalies[i] + ny*30
			puck.VX = (puck.VX-2*dot*nx)*.85 + nx*2
			puck.VY = (puck.VY-2*dot*ny)*.85 + ny*2
			puck.Owner = -1
			puck.Lock = 12
		}
	}
	if puck.Y < 47 || puck.Y > 553 {
		puck.Y = clamp(puck.Y, 47, 553)
		puck.VY = -puck.VY * .85
	}
	if puck.X < 37 || puck.X > 963 {
		if puck.Y > 225 && puck.Y < 375 {
			scorer := 0
			if puck.X < 37 {
				scorer = 1
			}
			s.Scores[scorer]++
			fresh := New()
			fresh.Tick = s.Tick
			fresh.Scores = s.Scores
			fresh.Goal = scorer
			fresh.Phase = "faceoff"
			fresh.Countdown = 120
			if s.Scores[scorer] >= WinScore {
				fresh.Phase = "finished"
				fresh.Winner = scorer
			}
			return fresh
		}
		puck.X = clamp(puck.X, 37, 963)
		puck.VX = -puck.VX * .85
	}
	if puck.Owner == -1 && puck.Lock == 0 {
		closest := 31.
		for i, p := range s.Players {
			distance := math.Hypot(p.X-puck.X, p.Y-puck.Y)
			if distance < closest {
				puck.Owner = i
				closest = distance
				puck.Lock = 15
			}
		}
	}
	return s
}
