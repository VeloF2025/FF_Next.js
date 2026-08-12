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

    Five things to get right when reporting the answer:

    - Build and activation have DIFFERENT denominators: poles for the build, drops for
      activations. Etwatwa has 4,538 poles and 21,008 drops, so they are not
      interchangeable and one can be imported without the other.
    - A `percent` of null is NOT zero. It means that denominator was never imported, and
      `absent` says which kind. Grabouw has 122 poles captured and no drops at all;
      reporting 0% activation there would be the opposite of the truth.
    - `slotsUnscored` counts photos the VLM never judged. They are not failures — quote
      pass, fail and unscored separately rather than implying everything was assessed.
    - `weeksRemainingAtCurrentRate` is a run rate, never a date, and is null when the
      current rate is too low to project from. Do not turn it into a delivery commitment.
    - Nothing here compares against a plan, because FibreFlow holds none. Never say a
      project is "on track" or "behind schedule" on the strength of this tool.

    For photos of a project use find_project_photos; for one photo use view_photo.
    """
    query = urllib.parse.urlencode({"project": project})
    return await anyio.to_thread.run_sync(partial(_overview_sync, query))


def _section_sync(project: str, section: str) -> str:
    query = urllib.parse.urlencode({"project": project, "section": section})
    return _fibreflow_get_sync("/api/reporting/project-section", query)


async def _section(project: str, section: str) -> str:
    return await anyio.to_thread.run_sync(partial(_section_sync, project, section))


@mcp.tool()
async def get_build_progress(project: str) -> str:
    """How far the physical build has got, and how fast it is moving.

    Poles captured against pole scope, poles approved, weekly capture for the last 12
    weeks, and — the useful part — how many poles have each of the 22 photo slots filled.

    Read the slot breakdown as a funnel. Capture rarely stops at a pole; it stops at a
    STEP. Etwatwa has 1,171 poles with a Before Photo and 313 with a Pole Label, so 858
    poles are part-captured rather than unstarted, and the label step is where the field
    process is failing. Quote the shape of that drop-off, not just the pole count.

    Build scope is POLES. Activations are measured against drops and are a different
    question — use get_activation_progress for those.
    """
    return await _section(project, "build")


@mcp.tool()
async def get_qa_status(project: str) -> str:
    """Whether the captured work would survive acceptance: VLM verdicts per photo slot,
    which steps fail most, retakes outstanding, and open snags by age.

    Verdicts come in THREE kinds and must be reported as three. `neverScored` is not a
    pass — Etwatwa has 2,813 passes, 3,989 failures and 5,757 slots the VLM never judged,
    so a single "pass rate" describes a project that does not exist. The rate returned is
    of the scored slots only, and says so.

    `worstSlots` is the actionable number: failures concentrated on one step mean a crew
    doing one thing wrong, which is fixable, while failures spread evenly do not.
    """
    return await _section(project, "quality")


@mcp.tool()
async def get_snags_summary(project: str) -> str:
    """Outstanding snags for a project: how many, how severe, and how old.

    Returns the same payload as get_qa_status — snags are reported alongside the QA
    verdicts that generate them, because a snag count without the failure pattern behind
    it cannot be acted on. Read the `snags` block.

    'fixed' is not 'verified': a snag stays outstanding until someone has checked the
    fix, and a snag with no status at all is counted as outstanding rather than dropped.
    """
    return await _section(project, "quality")


@mcp.tool()
async def get_activation_progress(project: str) -> str:
    """Customer activations: how many homes are connected, against how many are in scope,
    and the weekly trend.

    Activations are measured against DROPS — one drop is one home — which is a different
    scope from the pole build. A project can have poles imported and no drops (Grabouw
    has 3,793 poles in scope and no drops at all); when that happens the percentage is
    withheld rather than shown as 0%, and the caveat says so. Never read a withheld
    activation percentage as "nothing has been activated".
    """
    return await _section(project, "delivery")


@mcp.tool()
async def get_procurement_summary(project: str) -> str:
    """Purchase orders and BOQ for a project: counts, values, status breakdown, and how
    many POs are waiting on approval.

    Returns the same payload as get_activation_progress; read the `procurement` block.
    Values are in rands as recorded on the order. This reports commitments, not spend —
    an approved PO is money committed, not money paid.
    """
    return await _section(project, "delivery")
