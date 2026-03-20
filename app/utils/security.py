"""Security utilities for input validation and sanitization."""

import os
import re
from pathlib import Path

from urllib.parse import urlparse

from fastapi import HTTPException

from app.config import settings


def validate_filename(filename: str, allowed_extensions: list | None = None, /) -> str:
    """Validate and sanitize a filename to prevent path traversal attacks.

    Args:
        filename: The filename to validate
        allowed_extensions: List of allowed file extensions (e.g., ['.json', '.txt'])

    Returns:
        Sanitized filename (basename only)

    Raises:
        HTTPException: If filename is invalid or contains path traversal attempts
    """
    if not filename:
        raise HTTPException(status_code=400, detail="Filename cannot be empty")

    # Check for path traversal attempts
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(
            status_code=400,
            detail="Invalid filename: path traversal attempts are not allowed",
        )

    # Check for null bytes
    if "\0" in filename:
        raise HTTPException(
            status_code=400, detail="Invalid filename: null bytes not allowed"
        )

    # Strip any directory components (defense in depth)
    clean_filename = os.path.basename(filename)

    # Validate filename pattern (alphanumeric, dash, underscore, dot only)
    if not re.match(r"^[a-zA-Z0-9._-]+$", clean_filename):
        raise HTTPException(
            status_code=400,
            detail="Invalid filename: only alphanumeric characters, dots, dashes, and underscores allowed",
        )

    # Check file extension if specified
    if allowed_extensions:
        if not any(clean_filename.endswith(ext) for ext in allowed_extensions):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file extension: allowed extensions are {allowed_extensions}",
            )

    return clean_filename


def get_safe_filepath(
    filename: str, base_dir: str, allowed_extensions: list | None = None
) -> Path:
    """Get a safe file path within a base directory.

    Args:
        filename: The filename to use
        base_dir: The base directory to constrain files to
        allowed_extensions: List of allowed file extensions

    Returns:
        Resolved Path object within base_dir

    Raises:
        HTTPException: If the path escapes the base directory
    """
    # Validate and sanitize filename
    clean_filename = validate_filename(filename, allowed_extensions)

    # Ensure base directory exists
    base_path = Path(base_dir).resolve()
    base_path.mkdir(parents=True, exist_ok=True)

    # Construct the full path
    full_path = (base_path / clean_filename).resolve()

    # Verify the path is within base_dir (defense in depth)
    try:
        full_path.relative_to(base_path)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid path: file must be within the designated directory",
        )

    return full_path


def validate_model_path(category: str, model_name: str) -> tuple[str, str]:
    """Validate category and model name for path traversal attacks.

    Args:
        category: The model category (e.g., 'buildings', 'vehicles')
        model_name: The model filename

    Returns:
        Tuple of (validated_category, validated_model_name)

    Raises:
        HTTPException: If category or model_name contains invalid characters
    """
    # Validate category (no path separators, no parent directory references)
    if not category or ".." in category or "/" in category or "\\" in category:
        raise HTTPException(
            status_code=400,
            detail="Invalid category: path traversal attempts are not allowed",
        )

    # Validate model name
    if not model_name or ".." in model_name or "/" in model_name or "\\" in model_name:
        raise HTTPException(
            status_code=400,
            detail="Invalid model name: path traversal attempts are not allowed",
        )

    # Only allow alphanumeric, dots, dashes, and underscores
    if not re.match(r"^[a-zA-Z0-9._-]+$", category):
        raise HTTPException(
            status_code=400,
            detail="Invalid category: only alphanumeric characters, dots, dashes, and underscores allowed",
        )

    if not re.match(r"^[a-zA-Z0-9._-]+$", model_name):
        raise HTTPException(
            status_code=400,
            detail="Invalid model name: only alphanumeric characters, dots, dashes, and underscores allowed",
        )

    return category, model_name


def validate_api_url(url: str) -> bool:
    """Validate that an API URL is in the allowed domains list (SSRF prevention).

    Args:
        url: The URL to validate

    Returns:
        True if URL is allowed, False otherwise
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname

        if not hostname:
            return False

        # Check if hostname is in allowed domains
        for allowed_domain in settings.allowed_api_domains:
            if hostname == allowed_domain or hostname.endswith(f".{allowed_domain}"):
                return True

        return False
    except Exception:
        return False


def validate_proxy_path(path: str) -> str:
    """Validate and sanitize a proxy path to prevent SSRF and path traversal.

    Ensures the path:
    - Contains no scheme (http://, https://)
    - Contains no authority components (@)
    - Contains no parent directory traversal (..)
    - Contains no double slashes (//)
    - Contains no encoded traversal sequences
    - Resolves to a safe relative path

    Args:
        path: The raw path from the proxy request

    Returns:
        Sanitized path safe to append to the base URL

    Raises:
        ValueError: If the path contains disallowed patterns
    """
    if not path:
        return ""

    # Reject schemes — path should never be a full URL
    if "://" in path:
        raise ValueError("Proxy path must not contain a URL scheme")

    # Reject authority component (@) — prevents http://user@evil.com tricks
    if "@" in path:
        raise ValueError("Proxy path must not contain '@'")

    # Reject parent directory traversal (both encoded and literal)
    # Check before and after URL decoding
    if ".." in path:
        raise ValueError("Proxy path must not contain '..'")

    # Reject double slashes — prevents //evil.com protocol-relative URLs
    if "//" in path:
        raise ValueError("Proxy path must not contain '//'")

    # Reject encoded variants: %2e = '.', %2f = '/'
    lower = path.lower()
    if "%2e" in lower or "%2f" in lower or "%5c" in lower:
        raise ValueError("Proxy path must not contain encoded traversal characters")

    # Reject backslashes
    if "\\" in path:
        raise ValueError("Proxy path must not contain backslashes")

    # Reject null bytes
    if "\0" in path:
        raise ValueError("Proxy path must not contain null bytes")

    # Only allow safe URL path characters
    # Letters, digits, hyphen, dot, underscore, tilde, colon, @-sign (already rejected above),
    # slash, question mark, hash, brackets, equals, ampersand, plus, comma, semicolon, percent
    # But we keep it simple: the path should only contain path segments and trailing slashes
    # that look like /42/ or /search/ etc.
    if not re.match(r'^[a-zA-Z0-9_.~:/?#\[\]=&+,;%-]*$', path):
        raise ValueError("Proxy path contains disallowed characters")

    return path.lstrip("/")
