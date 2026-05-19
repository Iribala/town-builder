package models

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type Rotation struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type Scale struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type PlacedObject = map[string]any

type TownData struct {
	Buildings []PlacedObject `json:"buildings"`
	Vehicles  []PlacedObject `json:"vehicles"`
	Trees     []PlacedObject `json:"trees"`
	Props     []PlacedObject `json:"props"`
	Street    []PlacedObject `json:"street"`
	Park      []PlacedObject `json:"park"`
	Terrain   []PlacedObject `json:"terrain"`
	Roads     []PlacedObject `json:"roads"`
	TownName  string         `json:"townName,omitempty"`
	Snapshots []PlacedObject `json:"snapshots,omitempty"`
	History   []PlacedObject `json:"history,omitempty"`
}

func NewDefaultTownData() *TownData {
	return &TownData{Buildings: []PlacedObject{}, Vehicles: []PlacedObject{}, Trees: []PlacedObject{}, Props: []PlacedObject{}, Street: []PlacedObject{}, Park: []PlacedObject{}, Terrain: []PlacedObject{}, Roads: []PlacedObject{}}
}
