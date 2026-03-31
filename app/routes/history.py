"""Routes for operation history and undo/redo functionality."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.models.schemas import HistoryResponse, HistoryEntry
from app.services.auth import get_current_user
from app.services.history import history_manager
from app.services.storage import get_town_data, set_town_data
from app.services.events import broadcast_sse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/history", tags=["History & Undo/Redo"])


async def _restore_state(
    entry: dict,
    state_key: str,
    action: str,
    past_tense: str,
    push_fn,
):
    """Restore town state from a history entry.

    Args:
        entry: History entry containing state data
        state_key: Key in entry to get state from (e.g., "before_state", "after_state")
        action: Action name for logging (e.g., "undo", "redo")
        past_tense: Past tense for response message (e.g., "Undid", "Redid")
        push_fn: Async function to push entry to the appropriate stack

    Returns:
        Response dictionary
    """
    state = entry.get(state_key)
    if state is None:
        raise HTTPException(status_code=400, detail=f"Cannot {action}: no {state_key}")

    await set_town_data(state)
    await push_fn(entry)
    await broadcast_sse({"type": "full", "town": state})

    logger.info(f"{action.capitalize()} operation: {entry.get('operation')}")

    return {
        "status": "success",
        "message": f"{past_tense} {entry.get('operation')} operation",
        "can_undo": await history_manager.can_undo(),
        "can_redo": await history_manager.can_redo(),
    }


@router.get("", response_model=HistoryResponse)
async def get_history(limit: int = 50, current_user: dict = Depends(get_current_user)):
    """Get operation history.

    Args:
        limit: Maximum number of history entries to return
        current_user: Authenticated user

    Returns:
        List of history entries with undo/redo status

    Example:
        GET /api/history?limit=20
    """
    try:
        history = await history_manager.get_history(limit)

        return HistoryResponse(
            status="success",
            history=[HistoryEntry(**entry) for entry in history],
            can_undo=await history_manager.can_undo(),
            can_redo=await history_manager.can_redo(),
        )

    except Exception as e:
        logger.error(f"Get history error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/undo")
async def undo_operation(current_user: dict = Depends(get_current_user)):
    """Undo the last operation.

    Args:
        current_user: Authenticated user

    Returns:
        Success status and message

    Example:
        POST /api/history/undo
    """
    try:
        if not await history_manager.can_undo():
            raise HTTPException(status_code=400, detail="Nothing to undo")

        last_entry = await history_manager.pop_last_entry()
        if not last_entry:
            raise HTTPException(status_code=400, detail="Failed to get last operation")

        return await _restore_state(
            last_entry,
            "before_state",
            "undo",
            "Undid",
            history_manager.push_redo_entry,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Undo error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/redo")
async def redo_operation(current_user: dict = Depends(get_current_user)):
    """Redo the last undone operation.

    Args:
        current_user: Authenticated user

    Returns:
        Success status and message

    Example:
        POST /api/history/redo
    """
    try:
        if not await history_manager.can_redo():
            raise HTTPException(status_code=400, detail="Nothing to redo")

        redo_entry = await history_manager.pop_redo_entry()
        if not redo_entry:
            raise HTTPException(status_code=400, detail="Failed to get redo operation")

        async def _push_back_to_history(entry):
            await history_manager.add_entry(
                operation=entry.get("operation"),
                category=entry.get("category"),
                object_id=entry.get("object_id"),
                before_state=entry.get("before_state"),
                after_state=entry.get("after_state"),
            )

        return await _restore_state(
            redo_entry,
            "after_state",
            "redo",
            "Redid",
            _push_back_to_history,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Redo error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("")
async def clear_history(current_user: dict = Depends(get_current_user)):
    """Clear all history and redo stacks.

    Args:
        current_user: Authenticated user

    Returns:
        Success status

    Example:
        DELETE /api/history
    """
    try:
        await history_manager.clear_history()

        return {"status": "success", "message": "History cleared"}

    except Exception as e:
        logger.error(f"Clear history error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
