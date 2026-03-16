"""Utility functions for serving static files with correct MIME types."""

from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

STATIC_DIR = Path("static")


async def serve_js_files(file_path: str):
    """Serve JavaScript files with correct MIME type.

    Args:
        file_path: Path to the JS file (relative to static/js/)

    Returns:
        FileResponse with application/javascript MIME type
    """
    base_dir = (STATIC_DIR / "js").resolve()
    file_full_path = (base_dir / file_path).resolve()
    try:
        file_full_path.relative_to(base_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path")
    if not file_full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_full_path, media_type="application/javascript")


async def serve_wasm_files(file_path: str):
    """Serve WASM files with correct MIME type.

    Args:
        file_path: Path to the WASM file (relative to static/wasm/)

    Returns:
        FileResponse with appropriate MIME type
    """
    base_dir = (STATIC_DIR / "wasm").resolve()
    file_full_path = (base_dir / file_path).resolve()
    try:
        file_full_path.relative_to(base_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path")
    if not file_full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Determine correct MIME type based on file extension
    match file_full_path.suffix:
        case ".js":
            media_type = "application/javascript"
        case ".wasm":
            media_type = "application/wasm"
        case ".d.ts":
            media_type = "text/plain"
        case _:
            media_type = "application/octet-stream"

    return FileResponse(file_full_path, media_type=media_type)
