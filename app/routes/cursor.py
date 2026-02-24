"""Routes for collaborative cursor updates."""
from fastapi import APIRouter, Depends
from app.models.schemas import CursorUpdate
from app.services.auth import get_current_user
from app.services.events import broadcast_sse

router = APIRouter(tags=["Cursor"])


@router.post('/api/cursor/update')
async def update_cursor_position(
    cursor_data: CursorUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update cursor position for collaborative cursors.
    
    Args:
        cursor_data: Cursor position update with username, position, and camera position
        
    Returns:
        Success status
    """
    # Broadcast cursor update to all connected clients via SSE
    username = current_user.get("username", "unknown")
    await broadcast_sse({
        'type': 'cursor',
        'username': username,
        'position': {
            'x': cursor_data.position.x,
            'y': cursor_data.position.y,
            'z': cursor_data.position.z
        },
        'camera_position': {
            'x': cursor_data.camera_position.x,
            'y': cursor_data.camera_position.y,
            'z': cursor_data.camera_position.z
        }
    })
    
    return {'status': 'success', 'message': 'Cursor position updated'}
