"""The photo tool: let Claude actually LOOK at a FibreFlow photo.

`fibreflow_get` decodes every response as UTF-8 text, so an image endpoint comes back
as replacement characters and is then cut off at MAX_RESPONSE_CHARS — a 150 KB JPEG
arrives as 15,000 characters of mojibake with its JPEG header already destroyed. That
is not a fixable text response; an image needs a different content type on the way out.

`view_photo` fetches the same bytes through the SAME guards and returns them as MCP
image content, downscaled so one site photo does not swallow the context window.

Bulk download is deliberately NOT this tool's job. Image content is something the model
sees, not a file it can write to disk, and a project's depth photos run to gigabytes.
"""

from __future__ import annotations

import io
import urllib.error
import urllib.request
from functools import partial

import anyio.to_thread
from mcp.server.fastmcp import Image
from PIL import Image as PilImage
from PIL import ImageOps

from .server import mcp
from .tools import _access_token, _build_url, _guard_path, _rate_limit

# Claude's vision stack resamples anything longer than 1568px on its longest edge, so
# sending more pixels costs bandwidth and buys nothing. This is the ceiling AND the
# default: field photos are read for small detail (a label, a tape measure against a
# trench wall), and downscaling further to save tokens is what makes those unreadable.
MAX_DIMENSION = 1568
MIN_DIMENSION = 256

# JPEG quality for the re-encode. Kept high deliberately: these photos get read for
# serial numbers and labels, and q75 artefacts around small glyphs are exactly what
# makes a VLM misread a digit.
JPEG_QUALITY = 90

# How far over MAX_DIMENSION a photo may sit and still be forwarded untouched. QField
# photos are 1600px against a 1568px budget — 2% over. Shaving that costs a full
# re-encode that INFLATED a measured 388 KB photo to 623 KB, to save 32 pixels that
# Claude's own resampler would have taken off anyway. Above this slack the downscale is
# worth its re-encode; below it, it is pure loss.
PASSTHROUGH_SLACK = 1.25

# Ceiling on the raw download, before downscaling. Well above the ~900 KB average site
# photo, low enough that a mis-typed path pointing at an export route cannot stream
# unbounded bytes into memory.
MAX_SOURCE_BYTES = 25 * 1024 * 1024


class PhotoFetchError(RuntimeError):
    """A guard, upstream, or decode failure, phrased for the model rather than a log."""


def _fetch_photo_bytes(path: str, query: str) -> tuple[str, bytes]:
    """GET a FibreFlow path as raw bytes. Returns (content_type, data).

    Deliberately does NOT decode. Everything else here is the same path fibreflow_get
    takes — same denylist, same traversal guard, same per-token hourly budget — because
    a photo read is a read like any other and must not become a way around them.
    """
    target = path.strip()
    refusal = _guard_path(target)
    if refusal is not None:
        raise PhotoFetchError(str(refusal["message"]))

    token = _access_token()
    _rate_limit(token)

    req = urllib.request.Request(
        _build_url(target, query),
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "image/*",
            # Load-bearing: Cloudflare answers Error 1010 to the default Python
            # User-Agent on both *.fibreflow.app hosts. See .claude/modules/ff-remote-mcp.md.
            "User-Agent": "ff-remote-mcp/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
            # Read one byte past the ceiling so an oversize body is detectable rather
            # than silently truncated into a corrupt image.
            data = resp.read(MAX_SOURCE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        detail = exc.read(500).decode("utf-8", "replace")
        raise PhotoFetchError(
            f"FibreFlow returned HTTP {exc.code} for {target}. {detail}"
        ) from exc
    except urllib.error.URLError as exc:
        raise PhotoFetchError(f"FibreFlow unreachable: {exc.reason}") from exc

    if len(data) > MAX_SOURCE_BYTES:
        raise PhotoFetchError(
            f"That response is larger than {MAX_SOURCE_BYTES // (1024 * 1024)} MB, so it "
            "is not a single photo. Check the path — view_photo takes one photo, not an "
            "export or an archive."
        )
    return content_type, data


# Pillow's own bomb guard, set explicitly rather than left at the library default.
# MAX_SOURCE_BYTES bounds the COMPRESSED bytes only; a 25 MB image can still decode to
# hundreds of MB, and this is a single process serving every connected user.
PilImage.MAX_IMAGE_PIXELS = 80_000_000  # ~8x a 40MP phone photo


def _render(data: bytes, max_dimension: int) -> bytes:
    """Downscale to JPEG. Raises PhotoFetchError when the bytes are not an image.

    Returns the ORIGINAL bytes when re-encoding would only make them bigger. QField
    photos arrive already resized and compressed harder than JPEG_QUALITY, so blindly
    re-encoding them inflated a 388 KB photo to 623 KB — more bytes AND a second
    generation of JPEG artefacts, for an image of exactly the same dimensions.
    """
    try:
        with PilImage.open(io.BytesIO(data)) as img:
            source_format = img.format
            # 1 is "no rotation"; 2-8 all mean the pixels need moving. Cameras record
            # this instead of rotating, so without exif_transpose a portrait field photo
            # arrives on its side — which a model reads wrong rather than refuses.
            needs_rotation = (img.getexif() or {}).get(0x0112, 1) not in (1, None)
            fits_budget = max(img.size) <= max_dimension * PASSTHROUGH_SLACK

            img = ImageOps.exif_transpose(img)
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.thumbnail((max_dimension, max_dimension), PilImage.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
            rendered = out.getvalue()
    except PhotoFetchError:
        raise
    except Exception as exc:  # Pillow raises a wide family for malformed input
        raise PhotoFetchError(
            f"Those bytes could not be decoded as an image ({exc}). The path returned "
            "something else — check it with fibreflow_get first."
        ) from exc

    already_optimal = (
        source_format == "JPEG"
        and fits_budget
        and not needs_rotation
        and len(rendered) >= len(data)
    )
    return data if already_optimal else rendered


def _view_photo_sync(path: str, query: str, max_dimension: int) -> Image:
    bounded = max(MIN_DIMENSION, min(int(max_dimension), MAX_DIMENSION))
    content_type, data = _fetch_photo_bytes(path, query)

    if content_type and not content_type.startswith("image/"):
        # Almost always a JSON error the route returned with a 200, so show it: the
        # model can act on "Photo key parameter required" but not on "not an image".
        preview = data[:300].decode("utf-8", "replace")
        raise PhotoFetchError(
            f"That path returned {content_type}, not an image. Response: {preview}"
        )

    return Image(data=_render(data, bounded), format="jpeg")


@mcp.tool()
async def view_photo(path: str, query: str = "", max_dimension: int = MAX_DIMENSION) -> Image:
    """Look at a FibreFlow photo — use this whenever you are asked to check, inspect,
    describe, verify, or read anything IN a photo, rather than about it.

    `fibreflow_get` cannot do this: it returns text and mangles image bytes. Pass the
    photo route and its key as a urlencoded query, exactly as they appear in a photo
    listing:

      view_photo("/api/construction-qa/photo-proxy", "key=<storage_key>&source=local")
      view_photo("/api/construction-qa/photo-proxy", "key=<storage_key>&source=qfield")
      view_photo("/api/qfield/photo-proxy", "key=<photo_key>")

    QField photo keys start with `projects/`; construction-QA keys captured on site use
    `source=local`. One photo per call — to compare several, call it several times.
    You see only photos the signed-in user may see; a 403 means they lack access.
    """
    # anyio.to_thread for the same reason fibreflow_get uses it: FastMCP calls a sync
    # tool inline on the event loop, and this one does a blocking fetch AND a CPU-bound
    # resize, either of which would stall every other user's call in this one process.
    return await anyio.to_thread.run_sync(
        partial(_view_photo_sync, path, query, max_dimension)
    )
