"""Pydantic models for request/response validation."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Position(BaseModel):
    """3D position coordinates."""

    x: float = Field(default=0.0, ge=-100000, le=100000)
    y: float = Field(default=0.0, ge=-100000, le=100000)
    z: float = Field(default=0.0, ge=-100000, le=100000)


class Rotation(BaseModel):
    """3D rotation coordinates."""

    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


class Scale(BaseModel):
    """3D scale coordinates."""

    x: float = 1.0
    y: float = 1.0
    z: float = 1.0


class PlacedObject(BaseModel):
    """A placed 3D object in the town scene.

    Accepts extra fields to preserve kibigia's existing layout_data
    which may contain additional keys like 'modelName', 'color', etc.
    """

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    model: str | None = None
    category: str | None = None
    position: Position | dict[str, float] | list[float] | None = None
    rotation: Rotation | dict[str, float] | list[float] | None = None
    scale: Scale | dict[str, float] | list[float] | None = None
    driver: str | None = None


class ModelData(BaseModel):
    """Model data for a placed object."""

    id: str | None = None
    position: Position | None = None
    rotation: Rotation | None = None
    scale: Scale | None = None
    driver: str | None = None


class TownUpdateRequest(BaseModel):
    """Request to update town data."""

    model_config = ConfigDict(extra="allow")

    townName: str | None = None
    buildings: list[PlacedObject | dict[str, Any]] | None = None
    terrain: list[PlacedObject | dict[str, Any]] | None = None
    roads: list[PlacedObject | dict[str, Any]] | None = None
    props: list[PlacedObject | dict[str, Any]] | None = None
    driver: str | None = None
    id: str | None = None
    category: str | None = None


class SaveTownRequest(BaseModel):
    """Request to save town data."""

    data: dict[str, Any] | list[dict[str, Any]]
    filename: str | None = "town_data.json"
    town_id: int | None = None
    townName: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    description: str | None = None
    population: int | None = None
    area: float | None = None
    established_date: str | None = None
    place_type: str | None = None
    full_address: str | None = None
    town_image: str | None = None


class LoadTownRequest(BaseModel):
    """Request to load town data from file."""

    filename: str = "town_data.json"


class DeleteModelRequest(BaseModel):
    """Request to delete a model from the town."""

    id: str | None = None
    category: str
    position: Position | None = None

    @model_validator(mode="after")
    def require_id_or_position(self):
        if self.id is None and self.position is None:
            raise ValueError("Either 'id' or 'position' must be provided")
        return self


class EditModelRequest(BaseModel):
    """Request to edit a model in the town."""

    id: str
    category: str
    position: Position | None = None
    rotation: Rotation | None = None
    scale: Scale | None = None

    @model_validator(mode="after")
    def require_at_least_one_transform(self):
        if self.position is None and self.rotation is None and self.scale is None:
            raise ValueError(
                "At least one of 'position', 'rotation', or 'scale' must be provided"
            )
        return self


class CursorUpdate(BaseModel):
    """Cursor position update for collaborative cursors."""

    position: Position = Field(
        ..., description="3D world position where cursor is pointing"
    )
    camera_position: Position = Field(
        ..., description="Camera position for better context"
    )


class ApiResponse(BaseModel):
    """Standard API response."""

    status: str
    message: str | None = None
    data: dict[str, Any] | None = None
    town_id: str | None = None


# ===== Batch Operations =====


class BatchOperation(BaseModel):
    """Single operation in a batch request."""

    model_config = ConfigDict(extra="allow")

    op: Literal["create", "update", "delete", "edit"]
    category: str | None = None
    id: str | None = None
    data: dict[str, Any] | None = None
    position: Position | None = None


class BuildingCreateRequest(BaseModel):
    """Request to create a new building programmatically."""

    model: str  # Model filename (e.g., "house.glb")
    category: str = (
        "buildings"  # Category: buildings, vehicles, trees, props, street, park
    )
    position: Position
    rotation: Rotation | None = None
    scale: Scale | None = None


class BatchOperationRequest(BaseModel):
    """Request to execute multiple operations in a single transaction."""

    operations: list[BatchOperation] = Field(max_length=100)
    check_required_fields: bool = True


class BatchOperationResult(BaseModel):
    """Result of a single batch operation."""

    success: bool
    op: str
    message: str | None = None
    data: dict[str, Any] | None = None


class BatchOperationResponse(BaseModel):
    """Response from batch operations."""

    status: str
    results: list[BatchOperationResult]
    successful: int
    failed: int


# ===== Spatial Queries =====


class SpatialQueryRadius(BaseModel):
    """Query objects within a radius."""

    type: str = "radius"
    center: Position
    radius: float
    category: str | None = None
    limit: int | None = None


class SpatialQueryBounds(BaseModel):
    """Query objects within a bounding box."""

    type: str = "bounds"
    min: Position
    max: Position
    category: str | None = None
    limit: int | None = None


class SpatialQueryNearest(BaseModel):
    """Find nearest objects to a point."""

    type: str = "nearest"
    point: Position
    category: str | None = None
    count: int = 1
    max_distance: float | None = None


# ===== Advanced Filtering =====


class FilterCondition(BaseModel):
    """Single filter condition."""

    field: str
    operator: Literal["eq", "ne", "gt", "lt", "gte", "lte", "contains", "in"]
    value: Any


class QueryRequest(BaseModel):
    """Advanced query/filter request."""

    category: str | None = None
    filters: list[FilterCondition] | None = None
    sort_by: str | None = None
    sort_order: Literal["asc", "desc"] = "asc"
    limit: int | None = None
    offset: int = 0


# ===== Snapshots =====


class SnapshotCreate(BaseModel):
    """Create a new snapshot."""

    name: str | None = None
    description: str | None = None


class SnapshotInfo(BaseModel):
    """Snapshot information."""

    id: str
    name: str | None = None
    description: str | None = None
    timestamp: float
    size: int  # Number of objects


class SnapshotListResponse(BaseModel):
    """List of snapshots."""

    status: str
    snapshots: list[SnapshotInfo]


# ===== History/Undo =====


class HistoryEntry(BaseModel):
    """Single history entry."""

    id: str
    timestamp: float
    operation: str
    category: str | None = None
    object_id: str | None = None
    before_state: dict[str, Any] | None = None
    after_state: dict[str, Any] | None = None
    data: dict[str, Any] | None = None


class HistoryResponse(BaseModel):
    """Operation history response."""

    status: str
    history: list[HistoryEntry]
    can_undo: bool
    can_redo: bool


class BuildingUpdateRequest(BaseModel):
    """Request to update a building programmatically."""

    position: Position | None = None
    rotation: Rotation | None = None
    scale: Scale | None = None
    model: str | None = None
    category: str | None = None


class BuildingResponse(BaseModel):
    """Response with building data."""

    id: str
    model: str
    category: str
    position: Position
    rotation: Rotation
    scale: Scale
    driver: str | None = None
