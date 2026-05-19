package geometry

import (
	"github.com/kukichalang/kukicha/stdlib/cast"
	"math"
)

const DeleteProximityThreshold = 2.0

func coord(p map[string]any, key string) float64 {
	v, ok := p[key]
	if !ok {
		return 0.0
	}
	f, err := cast.SmartFloat64(v)
	if err != nil {
		return 0.0
	}
	return f
}

func CalculateDistance(p1 map[string]any, p2 map[string]any) float64 {
	dx := (coord(p1, "x") - coord(p2, "x"))
	dy := (coord(p1, "y") - coord(p2, "y"))
	dz := (coord(p1, "z") - coord(p2, "z"))
	return math.Sqrt((((dx * dx) + (dy * dy)) + (dz * dz)))
}
