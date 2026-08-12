"""Finding photos, and planning a bulk download of them.

Split from photo_tools.py to stay inside the project's 300-line file limit, and because
these two tools do something different from view_photo: they never touch image bytes.

The division of labour matters and the tool descriptions below enforce it:
  find_project_photos       -> metadata, one page at a time, for answering questions
  view_photo                -> ONE photo, as an image, for looking at it
  get_photo_download_manifest -> a link that puts thousands of photos in a folder

An MCP result cannot carry 10,000 rows, and image content is something the model sees
rather than a file it can save. So a bulk download returns a URL and the client fetches
it — which is why the manifest tool's response stays the same size for 10 photos or
10,000.
"""

from __future__ import annotations

import urllib.parse
from functools import partial
from typing import Literal

import anyio.to_thread

from .server import mcp
from .tools import _fibreflow_get_sync

Source = Literal["qa", "qfield", "both"]
Verdict = Literal["pass", "fail"]


def _query(**params: object) -> str:
    """Urlencode the parameters that were actually given, dropping the rest.

    Sending `type=None` would filter on the literal string "None" and quietly match
    nothing, which reads to the model as "this project has no depth photos".
    """
    present = {k: v for k, v in params.items() if v is not None and v != ""}
    return urllib.parse.urlencode(present)


def _search_sync(query: str) -> str:
    return _fibreflow_get_sync("/api/photos/search", query)


def _manifest_sync(query: str) -> str:
    return _fibreflow_get_sync("/api/photos/manifest", query)


@mcp.tool()
async def find_project_photos(
    project: str = "",
    type: str = "",
    source: Source = "both",
    vlm: Verdict | None = None,
    pole: str = "",
    zone: int | None = None,
    pon: int | None = None,
    from_date: str = "",
    to_date: str = "",
    limit: int = 25,
    offset: int = 0,
) -> str:
    """Find FibreFlow site photos by project and attributes. Call this FIRST for any
    question about photos — it is the only way to discover a photo's key.

    Searches construction-QA photos and QField photos together.

    - `project`: name or UUID, e.g. "Etwatwa". Matched loosely.
    - `type`: the kind of photo, matched against its label — "depth" finds "Depth Photo",
      "compaction" finds "Compaction / Backfill". QField photos use work types like
      "pole_installation" instead, so a type that exists in only one corpus narrows to it.
    - `source`: "qa" (construction QA), "qfield", or "both".
    - `vlm`: "pass" or "fail" — the automated verdict. There is no manual-review filter
      because that column is unpopulated; do not infer approval from its absence.
    - `pole`, `zone`, `pon`: identity filters. QField photos carry no zone or PON, so
      asking for one returns QA photos only.
    - `from_date`/`to_date`: ISO dates, on capture time.

    Each result carries a `view` block — pass its `path` and `query` straight to
    view_photo to look at that photo. `matched` is the FULL count; `photos` is one page.
    Sizes are missing for most photos, so `estimatedTotalMb` is an estimate and says so.
    """
    query = _query(
        project=project,
        type=type,
        source=source,
        vlm=vlm,
        pole=pole,
        zone=zone,
        pon=pon,
        **{"from": from_date, "to": to_date},
        limit=limit,
        offset=offset,
    )
    return await anyio.to_thread.run_sync(partial(_search_sync, query))


@mcp.tool()
async def get_photo_download_manifest(
    project: str = "",
    type: str = "",
    source: Source = "both",
    vlm: Verdict | None = None,
    pole: str = "",
    zone: int | None = None,
    pon: int | None = None,
    from_date: str = "",
    to_date: str = "",
) -> str:
    """Use this when asked to DOWNLOAD, save, export, or put photos in a folder — as
    opposed to looking at one (view_photo) or asking about them (find_project_photos).

    Takes the same filters as find_project_photos and returns a count, a size estimate,
    and a single `manifestUrl`. It does NOT return the photos: fetch `manifestUrl`
    yourself, and it answers with one download URL per matching photo, each valid for an
    hour. Download those to the folder the user asked for, keeping each file's
    `filename`.

    Do not call this in a loop to page through results — the manifest already covers
    every match, however many there are. Tell the user the count and the estimated size
    BEFORE downloading: a whole project can run to thousands of photos and gigabytes,
    and the estimate is extrapolated from the minority of photos with a recorded size.
    """
    query = _query(
        project=project,
        type=type,
        source=source,
        vlm=vlm,
        pole=pole,
        zone=zone,
        pon=pon,
        **{"from": from_date, "to": to_date},
    )
    return await anyio.to_thread.run_sync(partial(_manifest_sync, query))
