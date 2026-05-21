//go:build js && wasm

package main

import (
	"fmt"
	"math"
	"slices"
	"syscall/js"
)

type BoundingBox struct {
	MinX float64
	MinY float64
	MaxX float64
	MaxY float64
}

type CategoryMask = uint32

const CategoryUnknown CategoryMask = 1

const CategoryVehicle CategoryMask = 2

const CategoryBuilding CategoryMask = 4

const CategoryTerrain CategoryMask = 8

const CategoryProp CategoryMask = 16

const CategoryRoad CategoryMask = 32

const CategoryTree CategoryMask = 64

const CategoryPark CategoryMask = 128

func categoryFromString(category string) CategoryMask {
	switch category {
	case "vehicles":
		return CategoryVehicle
	case "buildings":
		return CategoryBuilding
	case "terrain":
		return CategoryTerrain
	case "props":
		return CategoryProp
	case "roads":
		return CategoryRoad
	case "trees":
		return CategoryTree
	case "park":
		return CategoryPark
	}
	return CategoryUnknown
}

type GameObject struct {
	ID           int
	X            float64
	Y            float64
	BBox         BoundingBox
	CategoryMask CategoryMask
}

type GridKey struct {
	X int
	Y int
}

type SpatialGrid struct {
	cellSize float64
	cells    map[GridKey][]int
}

func newSpatialGrid(cellSize float64) *SpatialGrid {
	return &SpatialGrid{cellSize: cellSize, cells: make(map[GridKey][]int, 256)}
}

func getCellKey(g *SpatialGrid, x float64, y float64) GridKey {
	return GridKey{X: int(math.Floor((x / g.cellSize))), Y: int(math.Floor((y / g.cellSize)))}
}

func getCellsForBBox(g *SpatialGrid, bbox BoundingBox) []GridKey {
	minKey := getCellKey(g, bbox.MinX, bbox.MinY)
	maxKey := getCellKey(g, bbox.MaxX, bbox.MaxY)
	cells := make([]GridKey, 0, (((maxKey.X - minKey.X) + 1) * ((maxKey.Y - minKey.Y) + 1)))
	{
		_xStart, _xEnd, _xStep := minKey.X, (maxKey.X + 1), 1
		if _xStart > _xEnd {
			_xStep = -1
		}
		for x := _xStart; x != _xEnd; x += _xStep {
			{
				_yStart, _yEnd, _yStep := minKey.Y, (maxKey.Y + 1), 1
				if _yStart > _yEnd {
					_yStep = -1
				}
				for y := _yStart; y != _yEnd; y += _yStep {
					cells = append(cells, GridKey{X: x, Y: y})
				}
			}
		}
	}
	return cells
}

func gridInsert(g *SpatialGrid, id int, bbox BoundingBox) {
	cells := getCellsForBBox(g, bbox)
	for _, cell := range cells {
		g.cells[cell] = append(g.cells[cell], id)
	}
}

func gridRemove(g *SpatialGrid, id int, bbox BoundingBox) {
	cells := getCellsForBBox(g, bbox)
	for _, cell := range cells {
		objects := g.cells[cell]
		i := slices.Index(objects, id)
		if i >= 0 {
			updated := slices.Delete(objects, i, (i + 1))
			if len(updated) == 0 {
				delete(g.cells, cell)
			} else {
				g.cells[cell] = updated
			}
		}
	}
}

func gridQuery(g *SpatialGrid, bbox BoundingBox) []int {
	cells := getCellsForBBox(g, bbox)
	seen := make(map[int]bool, 16)
	results := make([]int, 0, 16)
	for _, cell := range cells {
		objects, exists := g.cells[cell]
		if exists {
			for _, id := range objects {
				if !seen[id] {
					seen[id] = true
					results = append(results, id)
				}
			}
		}
	}
	return results
}

func gridClear(g *SpatialGrid) {
	g.cells = make(map[GridKey][]int, 256)
}

func checkAABBCollision(a BoundingBox, b BoundingBox) bool {
	return ((((a.MinX <= b.MaxX) && (a.MaxX >= b.MinX)) && (a.MinY <= b.MaxY)) && (a.MaxY >= b.MinY))
}

var spatialGrid = newSpatialGrid(10.0)

var objectCache = make(map[int]GameObject, 256)

func updateSpatialGrid(this js.Value, args []js.Value) any {
	if len(args) < 1 {
		return js.ValueOf(false)
	}
	objectsArray := args[0]
	length := objectsArray.Length()
	newGrid := newSpatialGrid(spatialGrid.cellSize)
	newCache := make(map[int]GameObject, length)
	for i := range length {
		obj := objectsArray.Index(i)
		id := obj.Get("id").Int()
		x := obj.Get("x").Float()
		y := obj.Get("y").Float()
		category := obj.Get("category").String()
		bboxJS := obj.Get("bbox")
		bbox := BoundingBox{MinX: bboxJS.Get("minX").Float(), MinY: bboxJS.Get("minY").Float(), MaxX: bboxJS.Get("maxX").Float(), MaxY: bboxJS.Get("maxY").Float()}
		gameObj := GameObject{ID: id, X: x, Y: y, BBox: bbox, CategoryMask: categoryFromString(category)}
		newCache[id] = gameObj
		gridInsert(newGrid, id, bbox)
	}
	objectCache = newCache
	spatialGrid = newGrid
	return js.ValueOf(true)
}

func checkCollision(this js.Value, args []js.Value) any {
	if len(args) < 2 {
		return js.ValueOf([]any{})
	}
	objID := args[0].Int()
	bboxJS := args[1]
	bbox := BoundingBox{MinX: bboxJS.Get("minX").Float(), MinY: bboxJS.Get("minY").Float(), MaxX: bboxJS.Get("maxX").Float(), MaxY: bboxJS.Get("maxY").Float()}
	candidateIDs := gridQuery(spatialGrid, bbox)
	collisions := make([]any, 0, 8)
	for _, candidateID := range candidateIDs {
		if candidateID == objID {
			continue
		}
		candidate, exists := objectCache[candidateID]
		if exists && checkAABBCollision(bbox, candidate.BBox) {
			collisions = append(collisions, candidateID)
		}
	}
	return js.ValueOf(collisions)
}

func batchCheckCollisions(this js.Value, args []js.Value) any {
	if len(args) < 1 {
		return js.ValueOf([]any{})
	}
	checksArray := args[0]
	length := checksArray.Length()
	results := make([]any, length)
	for i := range length {
		check := checksArray.Index(i)
		objID := check.Get("id").Int()
		bboxJS := check.Get("bbox")
		bbox := BoundingBox{MinX: bboxJS.Get("minX").Float(), MinY: bboxJS.Get("minY").Float(), MaxX: bboxJS.Get("maxX").Float(), MaxY: bboxJS.Get("maxY").Float()}
		candidateIDs := gridQuery(spatialGrid, bbox)
		collisions := make([]any, 0, 8)
		for _, candidateID := range candidateIDs {
			if candidateID == objID {
				continue
			}
			candidate, exists := objectCache[candidateID]
			if exists && checkAABBCollision(bbox, candidate.BBox) {
				collisions = append(collisions, candidateID)
			}
		}
		result := map[string]any{"id": objID, "collisions": collisions}
		results[i] = result
	}
	return js.ValueOf(results)
}

func findNearestObject(this js.Value, args []js.Value) any {
	if len(args) < 4 {
		return js.ValueOf(nil)
	}
	x := args[0].Float()
	y := args[1].Float()
	targetCategory := args[2].String()
	maxDistance := args[3].Float()
	targetMask := categoryFromString(targetCategory)
	searchRadius := spatialGrid.cellSize
	if searchRadius > maxDistance {
		searchRadius = maxDistance
	}
	nearestID := 0
	nearestDistSq := (maxDistance * maxDistance)
	found := false
	for searchRadius <= maxDistance {
		bbox := BoundingBox{MinX: (x - searchRadius), MinY: (y - searchRadius), MaxX: (x + searchRadius), MaxY: (y + searchRadius)}
		candidateIDs := gridQuery(spatialGrid, bbox)
		for _, id := range candidateIDs {
			obj, exists := objectCache[id]
			if !exists || (obj.CategoryMask != targetMask) {
				continue
			}
			dx := (obj.X - x)
			dy := (obj.Y - y)
			distSq := ((dx * dx) + (dy * dy))
			if distSq < nearestDistSq {
				nearestDistSq = distSq
				nearestID = id
				found = true
			}
		}
		if found {
			break
		}
		searchRadius = (searchRadius * 2)
		if searchRadius > maxDistance {
			searchRadius = maxDistance
		}
		if (searchRadius == maxDistance) && !found {
			finalBBox := BoundingBox{MinX: (x - maxDistance), MinY: (y - maxDistance), MaxX: (x + maxDistance), MaxY: (y + maxDistance)}
			finalCandidates := gridQuery(spatialGrid, finalBBox)
			for _, id := range finalCandidates {
				obj, exists := objectCache[id]
				if !exists || (obj.CategoryMask != targetMask) {
					continue
				}
				dx := (obj.X - x)
				dy := (obj.Y - y)
				distSq := ((dx * dx) + (dy * dy))
				if distSq < nearestDistSq {
					nearestDistSq = distSq
					nearestID = id
					found = true
				}
			}
			break
		}
	}
	if !found {
		return js.ValueOf(nil)
	}
	result := map[string]any{"id": nearestID, "distance": math.Sqrt(nearestDistSq)}
	return js.ValueOf(result)
}

func findObjectsInRadius(this js.Value, args []js.Value) any {
	if len(args) < 3 {
		return js.ValueOf([]any{})
	}
	x := args[0].Float()
	y := args[1].Float()
	radius := args[2].Float()
	filterMask := CategoryUnknown
	useFilter := false
	if ((len(args) >= 4) && !args[3].IsNull()) && !args[3].IsUndefined() {
		filterMask = categoryFromString(args[3].String())
		useFilter = true
	}
	bbox := BoundingBox{MinX: (x - radius), MinY: (y - radius), MaxX: (x + radius), MaxY: (y + radius)}
	candidateIDs := gridQuery(spatialGrid, bbox)
	results := make([]any, 0, len(candidateIDs))
	radiusSq := (radius * radius)
	for _, id := range candidateIDs {
		obj, exists := objectCache[id]
		if !exists {
			continue
		}
		if useFilter && (obj.CategoryMask != filterMask) {
			continue
		}
		dx := (obj.X - x)
		dy := (obj.Y - y)
		distSq := ((dx * dx) + (dy * dy))
		if distSq <= radiusSq {
			result := map[string]any{"id": id, "distance": math.Sqrt(distSq)}
			results = append(results, result)
		}
	}
	return js.ValueOf(results)
}

func getGridStats(this js.Value, args []js.Value) any {
	cellCount := len(spatialGrid.cells)
	totalObjects := 0
	for _, objects := range spatialGrid.cells {
		totalObjects = (totalObjects + len(objects))
	}
	avgObjectsPerCell := 0.0
	if cellCount > 0 {
		avgObjectsPerCell = (float64(totalObjects) / float64(cellCount))
	}
	result := map[string]any{"cellCount": cellCount, "objectCount": totalObjects, "avgObjectsPerCell": avgObjectsPerCell}
	return js.ValueOf(result)
}

type CarState struct {
	X         float64
	Z         float64
	RotationY float64
	VelocityX float64
	VelocityZ float64
}

func updateCarPhysics(this js.Value, args []js.Value) any {
	if len(args) < 3 {
		return js.ValueOf(nil)
	}
	ACCELERATION := 5.0
	MAX_SPEED := 20.0
	FRICTION := 0.02
	BRAKE_POWER := 10.0
	ROTATE_SPEED := 4.0
	carJS := args[0]
	car := CarState{X: carJS.Get("x").Float(), Z: carJS.Get("z").Float(), RotationY: carJS.Get("rotation_y").Float(), VelocityX: carJS.Get("velocity_x").Float(), VelocityZ: carJS.Get("velocity_z").Float()}
	inputJS := args[1]
	forward := inputJS.Get("forward").Bool()
	backward := inputJS.Get("backward").Bool()
	left := inputJS.Get("left").Bool()
	right := inputJS.Get("right").Bool()
	dt := args[2].Float()
	if dt > 0.1 {
		dt = 0.1
	}
	if left {
		car.RotationY = (car.RotationY + (ROTATE_SPEED * dt))
	}
	if right {
		car.RotationY = (car.RotationY - (ROTATE_SPEED * dt))
	}
	forwardX := math.Sin(car.RotationY)
	forwardZ := math.Cos(car.RotationY)
	if forward {
		car.VelocityX = (car.VelocityX + ((forwardX * ACCELERATION) * dt))
		car.VelocityZ = (car.VelocityZ + ((forwardZ * ACCELERATION) * dt))
	}
	if backward {
		speed := math.Sqrt(((car.VelocityX * car.VelocityX) + (car.VelocityZ * car.VelocityZ)))
		dot := ((car.VelocityX * forwardX) + (car.VelocityZ * forwardZ))
		if (dot > 0.0) && (speed > 0.0) {
			car.VelocityX = (car.VelocityX - (((car.VelocityX / speed) * BRAKE_POWER) * dt))
			car.VelocityZ = (car.VelocityZ - (((car.VelocityZ / speed) * BRAKE_POWER) * dt))
		} else {
			car.VelocityX = (car.VelocityX - ((forwardX * ACCELERATION) * dt))
			car.VelocityZ = (car.VelocityZ - ((forwardZ * ACCELERATION) * dt))
		}
	}
	frictionFactor := math.Pow((1.0 - FRICTION), (dt * 60.0))
	car.VelocityX = (car.VelocityX * frictionFactor)
	car.VelocityZ = (car.VelocityZ * frictionFactor)
	speed := math.Sqrt(((car.VelocityX * car.VelocityX) + (car.VelocityZ * car.VelocityZ)))
	if speed > MAX_SPEED {
		car.VelocityX = ((car.VelocityX / speed) * MAX_SPEED)
		car.VelocityZ = ((car.VelocityZ / speed) * MAX_SPEED)
	}
	if speed < 0.01 {
		car.VelocityX = 0.0
		car.VelocityZ = 0.0
	}
	car.X = (car.X + (car.VelocityX * dt))
	car.Z = (car.Z + (car.VelocityZ * dt))
	result := map[string]any{"x": car.X, "z": car.Z, "rotation_y": car.RotationY, "velocity_x": car.VelocityX, "velocity_z": car.VelocityZ}
	return js.ValueOf(result)
}

func registerCallbacks() {
	js.Global().Set("wasmUpdateSpatialGrid", js.FuncOf(updateSpatialGrid))
	js.Global().Set("wasmCheckCollision", js.FuncOf(checkCollision))
	js.Global().Set("wasmBatchCheckCollisions", js.FuncOf(batchCheckCollisions))
	js.Global().Set("wasmFindNearestObject", js.FuncOf(findNearestObject))
	js.Global().Set("wasmFindObjectsInRadius", js.FuncOf(findObjectsInRadius))
	js.Global().Set("wasmUpdateCarPhysics", js.FuncOf(updateCarPhysics))
	js.Global().Set("wasmGetGridStats", js.FuncOf(getGridStats))
}

func main() {
	registerCallbacks()
	fmt.Println("Physics WASM module loaded")
	select {}
}
