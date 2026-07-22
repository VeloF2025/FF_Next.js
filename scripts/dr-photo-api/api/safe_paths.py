"""Path containment helpers for request-derived filesystem paths.

Route handlers receive ``dr_number``, ``project`` and ``filename`` straight from
the URL. Joining those onto a storage root without validation lets a client that
does not normalise dot-segments (``curl --path-as-is``, a raw socket) escape the
root -- for reads, for writes, and for directory globs.

Every join of a request-controlled value onto a storage root must go through
``safe_join``.
"""

from pathlib import Path
from typing import Optional, Iterable

from fastapi import HTTPException

# Extensions we are willing to serve as image content.
ALLOWED_IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".webp"})

# Characters that must never appear inside a single path component.
_UNSAFE_CHARS = ("/", "\\", "\x00")


def is_safe_segment(segment: str) -> bool:
    """Return True when *segment* is a single, literal path component.

    Rejects empty strings, ``.``/``..``, and any value carrying a path
    separator or NUL byte.
    """
    if not isinstance(segment, str) or not segment:
        return False
    if segment in (".", ".."):
        return False
    return not any(char in segment for char in _UNSAFE_CHARS)


def safe_join(
    root: Path,
    *segments: str,
    allowed_suffixes: Optional[Iterable[str]] = None,
) -> Path:
    """Join *segments* under *root*, guaranteeing the result stays inside it.

    Args:
        root: Storage root. Resolved, so a relative root (``Path("data/...")``)
            is anchored to the process working directory.
        segments: Request-derived path components.
        allowed_suffixes: When given, the final path must carry one of these
            extensions (compared lower-case).

    Returns:
        The resolved, contained path. It is not guaranteed to exist.

    Raises:
        HTTPException: 400 when a segment is unsafe, the resolved path escapes
            *root*, or the extension is not allowed.
    """
    for segment in segments:
        if not is_safe_segment(segment):
            raise HTTPException(status_code=400, detail="Invalid path segment")

    safe_root = Path(root).resolve()
    candidate = safe_root.joinpath(*segments).resolve()

    # resolve() follows symlinks, so this also blocks a symlink inside the tree
    # that points outside of it.
    if candidate != safe_root and safe_root not in candidate.parents:
        raise HTTPException(status_code=400, detail="Invalid path")

    if allowed_suffixes is not None:
        allowed = {suffix.lower() for suffix in allowed_suffixes}
        if candidate.suffix.lower() not in allowed:
            raise HTTPException(status_code=400, detail="Invalid file type")

    return candidate


def safe_photo_path(root: Path, *segments: str) -> Path:
    """``safe_join`` restricted to servable image extensions."""
    return safe_join(root, *segments, allowed_suffixes=ALLOWED_IMAGE_SUFFIXES)
