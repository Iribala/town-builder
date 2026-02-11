"""Routes for Server-Sent Events (SSE) real-time updates."""
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.config import settings
from app.services.auth import verify_token_string
from app.services.events import event_stream

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Events"])


@router.get('/events')
async def sse_events(name: str = Query(None), token: str = Query(None)):
    """Server-Sent Events endpoint for real-time updates.

    EventSource doesn't support custom headers, so the JWT token
    is accepted as a query parameter instead.

    Args:
        name: Optional player/user name for tracking connected users
        token: Optional JWT token for authentication

    Returns:
        StreamingResponse with SSE event stream
    """
    if not settings.disable_jwt_auth:
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        verify_token_string(token)

    async def generate():
        async for msg in event_stream(name):
            yield msg

    return StreamingResponse(generate(), media_type='text/event-stream')
