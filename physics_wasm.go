//go:build js && wasm

package main

import (
	"math"
	"slices"
	"syscall/js"
)

// ============================================================================
// Data Structures
// ============================================================================

// BoundingBox represents an axis-aligned bounding box
type BoundingBox struct {
	MinX, MinY, MaxX, MaxY float64
}

// CategoryMask represents object categories as bit flags for fast filtering
type CategoryMask uint32

const (
	CategoryUnknown  CategoryMask = 1 << iota
	CategoryVehicle
	CategoryBuilding
	CategoryTerrain
	CategoryProp
	CategoryRoad
	CategoryTree
	CategoryPark
)

// categoryFromString converts string category to bitmask
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
	default:
		return CategoryUnknown
	}
}

// GameObject represents a game object with position and bounding box
type GameObject struct {
	ID           int
	X, Y         float64
	BBox         BoundingBox
	CategoryMask CategoryMask
}

// GridKey represents a cell in the spatial grid
type GridKey struct {
	X, Y int
}

// ============================================================================
// Spatial Grid
// ============================================================================

// SpatialGrid implements spatial partitioning for efficient collision detection.
// No mutexes are needed: Go WASM runs single-threaded (GOMAXPROCS=1).
type SpatialGrid struct {
	cellSize float64
	cells    map[GridKey][]int
}

// NewSpatialGrid creates a new spatial grid with the given cell size
func NewSpatialGrid(cellSize float64) *SpatialGrid {
	return &SpatialGrid{
		cellSize: cellSize,
		cells:    make(map[GridKey][]int, 256),
	}
}

// getCellKey returns the grid cell key for a given position
func (g *SpatialGrid) getCellKey(x, y float64) GridKey {
	return GridKey{
		X: int(math.Floor(x / g.cellSize)),
		Y: int(math.Floor(y / g.cellSize)),
	}
}

// getCellsForBBox returns all grid cells that intersect with a bounding box
func (g *SpatialGrid) getCellsForBBox(bbox BoundingBox) []GridKey {
	minKey := g.getCellKey(bbox.MinX, bbox.MinY)
	maxKey := g.getCellKey(bbox.MaxX, bbox.MaxY)

	cells := make([]GridKey, 0, (maxKey.X-minKey.X+1)*(maxKey.Y-minKey.Y+1))

	for x := minKey.X; x <= maxKey.X; x++ {
		for y := minKey.Y; y <= maxKey.Y; y++ {
			cells = append(cells, GridKey{X: x, Y: y})
		}
	}

	return cells
}

// Insert adds an object to the spatial grid
func (g *SpatialGrid) Insert(id int, bbox BoundingBox) {
	cells := g.getCellsForBBox(bbox)
	for _, cell := range cells {
		g.cells[cell] = append(g.cells[cell], id)
	}
}

// Remove removes an object from the spatial grid
func (g *SpatialGrid) Remove(id int, bbox BoundingBox) {
	cells := g.getCellsForBBox(bbox)
	for _, cell := range cells {
		objects := g.cells[cell]
		if i := slices.Index(objects, id); i >= 0 {
			updated := slices.Delete(objects, i, i+1)
			if len(updated) == 0 {
				delete(g.cells, cell)
			} else {
				g.cells[cell] = updated
			}
		}
	}
}

// Query returns all object IDs in cells that intersect with the given bounding box
func (g *SpatialGrid) Query(bbox BoundingBox) []int {
	cells := g.getCellsForBBox(bbox)
	seen := make(map[int]bool, 16)
	results := make([]int, 0, 16)

	for _, cell := range cells {
		if objects, exists := g.cells[cell]; exists {
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

// Clear removes all objects from the grid
func (g *SpatialGrid) Clear() {
	g.cells = make(map[GridKey][]int, 256)
}

// ============================================================================
// Collision Detection
// ============================================================================

// checkAABBCollision checks if two axis-aligned bounding boxes intersect
func checkAABBCollision(a, b BoundingBox) bool {
	return a.MinX <= b.MaxX && a.MaxX >= b.MinX &&
		a.MinY <= b.MaxY && a.MaxY >= b.MinY
}

// Global spatial grid instance
var spatialGrid = NewSpatialGrid(10.0)

// Global object cache
var objectCache = make(map[int]GameObject, 256)

// ============================================================================
// WASM Exported Functions
// ============================================================================

// distance calculates Euclidean distance between two points
func distance(this js.Value, args []js.Value) any {
	if len(args) < 4 {
		return js.ValueOf(0)
	}

	x1 := args[0].Float()
	y1 := args[1].Float()
	x2 := args[2].Float()
	y2 := args[3].Float()

	dx := x2 - x1
	dy := y2 - y1

	return js.ValueOf(math.Sqrt(dx*dx + dy*dy))
}

// updateSpatialGrid rebuilds the spatial grid with current objects.
// JavaScript signature: updateSpatialGrid(objects: Array<{id, x, y, bbox, category}>)
func updateSpatialGrid(this js.Value, args []js.Value) any {
	if len(args) < 1 {
		return js.ValueOf(false)
	}

	objectsArray := args[0]
	length := objectsArray.Length()

	// Build new cache and grid, then swap — avoids exposing partial state
	newGrid := NewSpatialGrid(spatialGrid.cellSize)
	newCache := make(map[int]GameObject, length)

	for i := range length {
		obj := objectsArray.Index(i)

		id := obj.Get("id").Int()
		x := obj.Get("x").Float()
		y := obj.Get("y").Float()
		category := obj.Get("category").String()

		bboxJS := obj.Get("bbox")
		bbox := BoundingBox{
			MinX: bboxJS.Get("minX").Float(),
			MinY: bboxJS.Get("minY").Float(),
			MaxX: bboxJS.Get("maxX").Float(),
			MaxY: bboxJS.Get("maxY").Float(),
		}

		gameObj := GameObject{
			ID:           id,
			X:            x,
			Y:            y,
			BBox:         bbox,
			CategoryMask: categoryFromString(category),
		}

		newCache[id] = gameObj
		newGrid.Insert(id, bbox)
	}

	// Atomic swap
	objectCache = newCache
	spatialGrid = newGrid

	return js.ValueOf(true)
}

// checkCollision checks if a single object collides with any objects in the grid.
// JavaScript signature: checkCollision(objId: number, bbox: {minX, minY, maxX, maxY}) -> number[]
func checkCollision(this js.Value, args []js.Value) any {
	if len(args) < 2 {
		return js.ValueOf([]any{})
	}

	objID := args[0].Int()
	bboxJS := args[1]

	bbox := BoundingBox{
		MinX: bboxJS.Get("minX").Float(),
		MinY: bboxJS.Get("minY").Float(),
		MaxX: bboxJS.Get("maxX").Float(),
		MaxY: bboxJS.Get("maxY").Float(),
	}

	candidateIDs := spatialGrid.Query(bbox)
	collisions := make([]any, 0, 8)

	for _, candidateID := range candidateIDs {
		if candidateID == objID {
			continue
		}

		if candidate, exists := objectCache[candidateID]; exists {
			if checkAABBCollision(bbox, candidate.BBox) {
				collisions = append(collisions, candidateID)
			}
		}
	}

	return js.ValueOf(collisions)
}

// batchCheckCollisions checks multiple objects for collisions in a single call.
// JavaScript signature: batchCheckCollisions(checks: Array<{id, bbox}>) -> Array<{id, collisions}>
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

		bbox := BoundingBox{
			MinX: bboxJS.Get("minX").Float(),
			MinY: bboxJS.Get("minY").Float(),
			MaxX: bboxJS.Get("maxX").Float(),
			MaxY: bboxJS.Get("maxY").Float(),
		}

		candidateIDs := spatialGrid.Query(bbox)
		collisions := make([]any, 0, 8)

		for _, candidateID := range candidateIDs {
			if candidateID == objID {
				continue
			}

			if candidate, exists := objectCache[candidateID]; exists {
				if checkAABBCollision(bbox, candidate.BBox) {
					collisions = append(collisions, candidateID)
				}
			}
		}

		result := map[string]any{
			"id":         objID,
			"collisions": collisions,
		}
		results[i] = result
	}

	return js.ValueOf(results)
}

// findNearestObject finds the nearest object of a given category to a position.
// Uses the spatial grid with expanding search radius to avoid full linear scan.
// JavaScript signature: findNearestObject(x, y, category, maxDistance) -> {id, distance} | null
func findNearestObject(this js.Value, args []js.Value) any {
	if len(args) < 4 {
		return js.ValueOf(nil)
	}

	x := args[0].Float()
	y := args[1].Float()
	targetCategory := args[2].String()
	maxDistance := args[3].Float()

	targetMask := categoryFromString(targetCategory)

	// Start with a small search radius and expand if needed
	searchRadius := spatialGrid.cellSize
	if searchRadius > maxDistance {
		searchRadius = maxDistance
	}

	var nearestID int
	nearestDistSq := maxDistance * maxDistance
	found := false

	for searchRadius <= maxDistance {
		bbox := BoundingBox{
			MinX: x - searchRadius,
			MinY: y - searchRadius,
			MaxX: x + searchRadius,
			MaxY: y + searchRadius,
		}

		candidateIDs := spatialGrid.Query(bbox)

		for _, id := range candidateIDs {
			obj, exists := objectCache[id]
			if !exists || obj.CategoryMask != targetMask {
				continue
			}

			dx := obj.X - x
			dy := obj.Y - y
			distSq := dx*dx + dy*dy

			if distSq < nearestDistSq {
				nearestDistSq = distSq
				nearestID = id
				found = true
			}
		}

		// If we found something within this radius, no need to expand
		if found {
			break
		}

		// Double the search radius
		searchRadius *= 2
		if searchRadius > maxDistance {
			searchRadius = maxDistance
		}
		// If we already searched at maxDistance, stop
		if searchRadius == maxDistance && !found {
			// Do one final search at maxDistance
			bbox := BoundingBox{
				MinX: x - maxDistance,
				MinY: y - maxDistance,
				MaxX: x + maxDistance,
				MaxY: y + maxDistance,
			}
			candidateIDs := spatialGrid.Query(bbox)
			for _, id := range candidateIDs {
				obj, exists := objectCache[id]
				if !exists || obj.CategoryMask != targetMask {
					continue
				}
				dx := obj.X - x
				dy := obj.Y - y
				distSq := dx*dx + dy*dy
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

	result := map[string]any{
		"id":       nearestID,
		"distance": math.Sqrt(nearestDistSq),
	}
	return js.ValueOf(result)
}

// findObjectsInRadius finds all objects within a given radius.
// JavaScript signature: findObjectsInRadius(x, y, radius, category?) -> Array<{id, distance}>
func findObjectsInRadius(this js.Value, args []js.Value) any {
	if len(args) < 3 {
		return js.ValueOf([]any{})
	}

	x := args[0].Float()
	y := args[1].Float()
	radius := args[2].Float()

	var filterMask CategoryMask
	useFilter := false
	if len(args) >= 4 && !args[3].IsNull() && !args[3].IsUndefined() {
		filterMask = categoryFromString(args[3].String())
		useFilter = true
	}

	bbox := BoundingBox{
		MinX: x - radius,
		MinY: y - radius,
		MaxX: x + radius,
		MaxY: y + radius,
	}

	candidateIDs := spatialGrid.Query(bbox)
	results := make([]any, 0, len(candidateIDs))
	radiusSq := radius * radius

	for _, id := range candidateIDs {
		obj, exists := objectCache[id]
		if !exists {
			continue
		}

		if useFilter && obj.CategoryMask != filterMask {
			continue
		}

		dx := obj.X - x
		dy := obj.Y - y
		distSq := dx*dx + dy*dy

		if distSq <= radiusSq {
			result := map[string]any{
				"id":       id,
				"distance": math.Sqrt(distSq),
			}
			results = append(results, result)
		}
	}

	return js.ValueOf(results)
}

// getGridStats returns statistics about the spatial grid for debugging.
// JavaScript signature: getGridStats() -> {cellCount, objectCount, avgObjectsPerCell}
func getGridStats(this js.Value, args []js.Value) any {
	cellCount := len(spatialGrid.cells)
	totalObjects := 0

	for _, objects := range spatialGrid.cells {
		totalObjects += len(objects)
	}

	avgObjectsPerCell := 0.0
	if cellCount > 0 {
		avgObjectsPerCell = float64(totalObjects) / float64(cellCount)
	}

	result := map[string]any{
		"cellCount":         cellCount,
		"objectCount":       totalObjects,
		"avgObjectsPerCell": avgObjectsPerCell,
	}
	return js.ValueOf(result)
}

// ============================================================================
// Car Physics
// ============================================================================

// CarState represents the state of a car for physics simulation.
// Uses X/Z coordinates matching the Three.js 3D coordinate system (Y is up).
type CarState struct {
	X, Z      float64
	RotationY float64
	VelocityX float64
	VelocityZ float64
}

// updateCarPhysics updates car physics based on input and delta time.
// JavaScript signature: updateCarPhysics(carState, inputState, deltaTime) -> carState
func updateCarPhysics(this js.Value, args []js.Value) any {
	if len(args) < 3 {
		return js.ValueOf(nil)
	}

	// Physics constants (per-second rates, scaled by deltaTime)
	const (
		ACCELERATION = 5.0
		MAX_SPEED    = 20.0
		FRICTION     = 0.02 // fraction of velocity lost per second
		BRAKE_POWER  = 10.0
		ROTATE_SPEED = 4.0
	)

	carJS := args[0]
	car := CarState{
		X:         carJS.Get("x").Float(),
		Z:         carJS.Get("z").Float(),
		RotationY: carJS.Get("rotation_y").Float(),
		VelocityX: carJS.Get("velocity_x").Float(),
		VelocityZ: carJS.Get("velocity_z").Float(),
	}

	inputJS := args[1]
	forward := inputJS.Get("forward").Bool()
	backward := inputJS.Get("backward").Bool()
	left := inputJS.Get("left").Bool()
	right := inputJS.Get("right").Bool()

	dt := args[2].Float()

	// Clamp deltaTime to prevent physics explosion after tab-away
	if dt > 0.1 {
		dt = 0.1
	}

	// Steering
	if left {
		car.RotationY += ROTATE_SPEED * dt
	}
	if right {
		car.RotationY -= ROTATE_SPEED * dt
	}

	// Forward direction based on rotation
	forwardX := math.Sin(car.RotationY)
	forwardZ := math.Cos(car.RotationY)

	// Acceleration
	if forward {
		car.VelocityX += forwardX * ACCELERATION * dt
		car.VelocityZ += forwardZ * ACCELERATION * dt
	}

	// Braking / reverse
	if backward {
		speed := math.Sqrt(car.VelocityX*car.VelocityX + car.VelocityZ*car.VelocityZ)
		dot := car.VelocityX*forwardX + car.VelocityZ*forwardZ

		if dot > 0.0 && speed > 0.0 {
			car.VelocityX -= (car.VelocityX / speed) * BRAKE_POWER * dt
			car.VelocityZ -= (car.VelocityZ / speed) * BRAKE_POWER * dt
		} else {
			car.VelocityX -= forwardX * ACCELERATION * dt
			car.VelocityZ -= forwardZ * ACCELERATION * dt
		}
	}

	// Friction: exponential decay based on dt
	frictionFactor := math.Pow(1.0-FRICTION, dt*60.0)
	car.VelocityX *= frictionFactor
	car.VelocityZ *= frictionFactor

	// Clamp speed
	speed := math.Sqrt(car.VelocityX*car.VelocityX + car.VelocityZ*car.VelocityZ)
	if speed > MAX_SPEED {
		car.VelocityX = (car.VelocityX / speed) * MAX_SPEED
		car.VelocityZ = (car.VelocityZ / speed) * MAX_SPEED
	}

	// Stop tiny movements
	if speed < 0.01 {
		car.VelocityX = 0.0
		car.VelocityZ = 0.0
	}

	// Update position
	car.X += car.VelocityX * dt
	car.Z += car.VelocityZ * dt

	result := map[string]any{
		"x":          car.X,
		"z":          car.Z,
		"rotation_y": car.RotationY,
		"velocity_x": car.VelocityX,
		"velocity_z": car.VelocityZ,
	}
	return js.ValueOf(result)
}

// ============================================================================
// Registration and Main
// ============================================================================

func registerCallbacks() {
	js.Global().Set("calcDistance", js.FuncOf(distance))
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
	println("Physics WASM module loaded")
	select {} // Keep Go running
}
