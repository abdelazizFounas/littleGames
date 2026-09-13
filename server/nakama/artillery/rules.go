// Package artillery implements deterministic Pocket Artillery ballistics and turn rules.
package artillery

import (
	"fmt"
	"math"
)

type Options struct {
	Map         string `json:"map"`
	BestOf      int    `json:"bestOf"`
	Health      int    `json:"health"`
	Wind        int    `json:"wind"`
	TurnSeconds int    `json:"turnSeconds"`
}
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
type Tank struct {
	Health     int  `json:"health"`
	Heavy      int  `json:"heavy"`
	Scatter    int  `json:"scatter"`
	Shield     bool `json:"shield"`
	ShieldUsed bool `json:"shieldUsed"`
}
type Shot struct {
	ID     int     `json:"id"`
	Player int     `json:"player"`
	Weapon string  `json:"weapon"`
	Angle  float64 `json:"angle"`
	Power  float64 `json:"power"`
	Path   []Point `json:"path"`
	Impact Point   `json:"impact"`
	Damage []int   `json:"damage"`
}
type State struct {
	Options  Options `json:"options"`
	Phase    string  `json:"phase"`
	Round    int     `json:"round"`
	Turn     int     `json:"turn"`
	Turns    int     `json:"turns"`
	Revision int     `json:"revision"`
	Wind     int     `json:"wind"`
	Tanks    []Tank  `json:"tanks"`
	Scores   []int   `json:"scores"`
	Ready    []bool  `json:"ready"`
	Winner   int     `json:"winner"`
	LastShot *Shot   `json:"lastShot"`
}
type Action struct {
	Type     string  `json:"type"`
	Options  Options `json:"options"`
	Angle    float64 `json:"angle"`
	Power    float64 `json:"power"`
	Weapon   string  `json:"weapon"`
	Revision int     `json:"revision"`
}

var DefaultOptions = Options{Map: "mesa", BestOf: 3, Health: 100, Wind: 1, TurnSeconds: 30}
var heights = map[string][]float64{"mesa": {430, 425, 470, 495, 445, 385, 430, 490, 460, 415, 425}, "alpine": {470, 425, 475, 390, 345, 310, 365, 405, 480, 425, 465}, "moon": {445, 425, 475, 480, 450, 475, 455, 475, 470, 425, 445}}

func ValidOptions(o Options) bool {
	_, exists := heights[o.Map]
	return exists && (o.BestOf == 1 || o.BestOf == 3 || o.BestOf == 5) && (o.Health == 100 || o.Health == 150) && o.Wind >= 0 && o.Wind <= 2 && (o.TurnSeconds == 20 || o.TurnSeconds == 30 || o.TurnSeconds == 45)
}
func Terrain(m string, x float64) float64 {
	at := math.Max(0, math.Min(9.99999, x/120))
	index := int(math.Floor(at))
	h := heights[m]
	return h[index] + (h[index+1]-h[index])*(at-float64(index))
}
func Position(m string, player int) Point {
	x := 120.
	if player == 1 {
		x = 1080
	}
	return Point{x, Terrain(m, x) - 13}
}
func WindFor(round, turns, strength int) int { return ((round*17+turns*13)%31 - 15) * strength }
func freshTank(health int) Tank              { return Tank{Health: health, Heavy: 2, Scatter: 2} }
func New(o Options) State {
	return State{Options: o, Phase: "setup", Round: 1, Wind: WindFor(1, 0, o.Wind), Tanks: []Tank{freshTank(o.Health), freshTank(o.Health)}, Scores: []int{0, 0}, Ready: []bool{false, false}, Winner: -1}
}
func Trajectory(s State, player int, angle, power float64) ([]Point, Point) {
	origin := Position(s.Options.Map, player)
	radians := angle * math.Pi / 180
	x := origin.X + math.Cos(radians)*30
	y := origin.Y - math.Sin(radians)*30
	vx := math.Cos(radians) * power * 5.5
	vy := -math.Sin(radians) * power * 5.5
	path := []Point{{x, y}}
	gravity := 180.
	if s.Options.Map == "moon" {
		gravity = 110
	}
	for step := 0; step < 1200; step++ {
		vx += float64(s.Wind) / 60
		vy += gravity / 60
		x += vx / 60
		y += vy / 60
		p := Point{x, y}
		if step%3 == 0 {
			path = append(path, p)
		}
		hit := false
		for seat := 0; seat < 2; seat++ {
			tank := Position(s.Options.Map, seat)
			if step > 5 && math.Hypot(x-tank.X, y-tank.Y) < 23 {
				hit = true
			}
		}
		if x < -100 || x > 1300 || y > 650 || y >= Terrain(s.Options.Map, x) || hit {
			path = append(path, p)
			return path, p
		}
	}
	p := Point{x, y}
	return append(path, p), p
}
func endTurn(s State) State {
	if s.Tanks[0].Health <= 0 || s.Tanks[1].Health <= 0 || s.Turns >= 60 {
		s.Winner = -1
		if s.Tanks[0].Health > s.Tanks[1].Health {
			s.Winner = 0
		}
		if s.Tanks[1].Health > s.Tanks[0].Health {
			s.Winner = 1
		}
		if s.Winner >= 0 {
			s.Scores[s.Winner]++
		}
		s.Phase = "round-over"
		s.Ready = []bool{false, false}
		if s.Scores[0] >= (s.Options.BestOf+1)/2 || s.Scores[1] >= (s.Options.BestOf+1)/2 {
			s.Phase = "finished"
		}
		return s
	}
	s.Turn = 1 - s.Turn
	s.Wind = WindFor(s.Round, s.Turns, s.Options.Wind)
	return s
}
func Act(state State, player int, a Action) (State, error) {
	refuse := func(message string) (State, error) { return state, fmt.Errorf("%s", message) }
	if player < 0 || player > 1 {
		return refuse("Unknown commander.")
	}
	s := state
	s.Tanks = append([]Tank(nil), state.Tanks...)
	s.Scores = append([]int(nil), state.Scores...)
	s.Ready = append([]bool(nil), state.Ready...)
	if a.Type == "configure" {
		if player != 0 || s.Phase != "setup" || !ValidOptions(a.Options) {
			return refuse("Only the host can configure an unstarted match.")
		}
		s = New(a.Options)
		s.Revision = state.Revision + 1
		return s, nil
	}
	if a.Type == "ready" {
		if s.Phase != "setup" && s.Phase != "round-over" {
			return refuse("The round is already running.")
		}
		s.Ready[player] = true
		s.Revision++
		if s.Ready[0] && s.Ready[1] {
			if s.Phase == "round-over" {
				s.Round++
			}
			s.Phase = "playing"
			s.Turn = (s.Round - 1) % 2
			s.Turns = 0
			s.Wind = WindFor(s.Round, 0, s.Options.Wind)
			s.Tanks = []Tank{freshTank(s.Options.Health), freshTank(s.Options.Health)}
			s.Winner = -1
			s.LastShot = nil
		}
		return s, nil
	}
	if s.Phase != "playing" || s.Turn != player {
		return refuse("Wait for your turn.")
	}
	if a.Type == "shield" {
		if s.Tanks[player].ShieldUsed {
			return refuse("Your shield has already been used this round.")
		}
		s.Tanks[player].Shield = true
		s.Tanks[player].ShieldUsed = true
		s.Turns++
		s.Revision++
		return endTurn(s), nil
	}
	if a.Type == "pass" {
		s.Turns++
		s.Revision++
		return endTurn(s), nil
	}
	if a.Type != "fire" || math.IsNaN(a.Angle) || math.IsInf(a.Angle, 0) || math.IsNaN(a.Power) || math.IsInf(a.Power, 0) || a.Angle < 5 || a.Angle > 175 || a.Power < 10 || a.Power > 100 {
		return refuse("Choose a valid angle, power, and weapon.")
	}
	radius, damage := 76., 55.
	switch a.Weapon {
	case "shell":
	case "heavy":
		radius = 110
		damage = 75
		if s.Tanks[player].Heavy <= 0 {
			return refuse("That weapon is out of ammunition.")
		}
		s.Tanks[player].Heavy--
	case "scatter":
		radius = 145
		damage = 42
		if s.Tanks[player].Scatter <= 0 {
			return refuse("That weapon is out of ammunition.")
		}
		s.Tanks[player].Scatter--
	default:
		return refuse("Unknown weapon.")
	}
	path, impact := Trajectory(s, player, a.Angle, a.Power)
	damages := []int{0, 0}
	for i := range s.Tanks {
		target := Position(s.Options.Map, i)
		amount := damage * math.Max(0, 1-math.Max(0, math.Hypot(impact.X-target.X, impact.Y-target.Y)-23)/radius)
		if s.Tanks[i].Shield {
			amount *= .5
		}
		damages[i] = int(math.Floor(amount + .5))
		s.Tanks[i].Health = max(0, s.Tanks[i].Health-damages[i])
		if damages[i] > 0 {
			s.Tanks[i].Shield = false
		}
	}
	s.Revision++
	s.Turns++
	s.LastShot = &Shot{ID: s.Revision, Player: player, Weapon: a.Weapon, Angle: a.Angle, Power: a.Power, Path: path, Impact: impact, Damage: damages}
	return endTurn(s), nil
}
