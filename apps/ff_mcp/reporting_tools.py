"""Project reporting tools — answers, not tables.

The connector already reaches 732 routes, so this module exists for a different reason
than access: a raw REST route returns rows, and rows do not survive a 15,000-character
response cap. Listing all 21 projects is 22 kB and arrives truncated; one project's pole
reviews are 890 MB. A reporting tool has to aggregate server-side or it cannot answer.

These tools answer with ACTUALS and rates. FibreFlow holds no maintained schedule —
`progress_percentage` is 0 on every project — so no tool here can say whether a project
is ahead of or behind plan, and each says so rather than implying otherwise.
"""

from __future__ import annotations

import urllib.parse
from functools import partial

import anyio.to_thread

from .server import mcp
from .tools import _fibreflow_get_sync


def _overview_sync(query: str) -> str:
    return _fibreflow_get_sync("/api/reporting/project-overview", query)


@mcp.tool()
async def get_project_overview(project: str) -> str:
    """Answer "how is <project> doing?" — the first tool to reach for on any question
    about a project's status, progress, quality or outstanding work.

    Give a project name or UUID; names match loosely ("Etwatwa", "Thembisa POP 1").

    Returns actuals in one call: SOW scope, poles built, poles with an after-photo, poles
    approved, weekly throughput, VLM pass/fail per photo slot, activations, open snags and
    purchase orders — plus `caveats` you should read and pass on.

    Three things to get right when reporting the answer:

    - A `percent` of null is NOT zero. It means the denominator is missing — usually that
      the SOW was never imported — and `absent` says which. Tonga has 1,360 poles built
      against no imported scope; reporting 0% there would be the opposite of the truth.
    - `weeksRemainingAtCurrentRate` is a run rate, never a date, and is null when the
      current rate is too low to project from. Do not turn it into a delivery commitment.
    - Nothing here compares against a plan, because FibreFlow holds none. Never say a
      project is "on track" or "behind schedule" on the strength of this tool.

    For photos of a project use find_project_photos; for one photo use view_photo.
    """
    query = urllib.parse.urlencode({"project": project})
    return await anyio.to_thread.run_sync(partial(_overview_sync, query))
