"""Routes for Server-Sent Events (SSE) real-time updates."""
import logging

from fastapi import APIRouter, Cookie, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.config import settings
from app.services.auth import verify_token_string
from app.services.events import event_stream

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Events"])


@router.get('/events')
async def sse_events(name: str = Query(None), auth_token: str | None = Cookie(None)):
    """Server-Sent Events endpoint for real-time updates.

    The JWT token is read from the `auth_token` cookie, which the client sets
    before opening the EventSource connection (native EventSource does not
    support custom headers).

    Args:
        name: Optional player/user name for tracking connected users
        auth_token: JWT token from the auth_token cookie

    Returns:
        StreamingResponse with SSE event stream
    """
    if not settings.disable_jwt_auth:
        if not auth_token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        verify_token_string(auth_token)

    async def generate():
        async for msg in event_stream(name):
            yield msg

    return StreamingResponse(generate(), media_type='text/event-stream')
