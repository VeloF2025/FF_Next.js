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
from .tools import _fibreflow_get_sync, build_query


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


def _action_items_sync(query: str) -> str:
    return _fibreflow_get_sync("/api/reporting/action-items", query)


@mcp.tool()
async def get_action_items(
    assignee: str = "",
    state: str = "open",
    older_than_days: int | None = None,
    source: str = "",
    limit: int = 25,
) -> str:
    """The action-item backlog: how many are open, who is carrying them, how stale they
    are, and how fast they arrive versus get closed.

    - `assignee`: matched loosely against a FREE-TEXT name field.
    - `state`: "open" (default), "completed" or "all".
    - `older_than_days`: only items older than this.
    - `source`: "transcript", "cortex-scribe", "visual", "system".

    Read the result carefully before repeating the headline number, because it is easy to
    state something false:

    - Around 97% of open items were extracted AUTOMATICALLY from meeting transcripts. An
      open machine-extracted item is an untriaged suggestion, not a commitment somebody
      made and broke. Never present the count as work people promised and failed to do.
    - The create-versus-close ratio (~37x) is the shape of an extraction pipeline with no
      triage step. It is not a measure of anyone's delivery, and saying so about a named
      person would be both wrong and unfair.
    - Assignee is free text and the same person appears under several spellings, so every
      per-person total is a FLOOR, not a count.
    - There is no useful project or due-date dimension: project_id is populated on a
      handful of rows out of thousands and due dates on fewer. Do not offer "action items
      for project X" or "overdue items" — the data cannot answer either.
    """
    query = build_query(
        assignee=assignee,
        state=state,
        olderThanDays=older_than_days,
        source=source,
        limit=limit,
    )
    return await anyio.to_thread.run_sync(partial(_action_items_sync, query))


def _meetings_sync(query: str) -> str:
    return _fibreflow_get_sync("/api/reporting/meetings", query)


@mcp.tool()
async def find_meetings(
    search: str = "",
    since: str = "",
    until: str = "",
    with_transcript: bool | None = None,
    limit: int = 50,
) -> str:
    """Find meetings YOU attended: when they happened, who was in them, whether a
    transcript or summary was captured, and how many action items came out of each.

    - `search`: matched against the meeting TITLE only, not its contents.
    - `since` / `until`: `YYYY-MM-DD`, inclusive of the whole `until` day.
    - `with_transcript`: True for only meetings with a stored transcript, False for only
      those without.

    Returns an INDEX, not contents. It carries no transcript text, no summary text and no
    action-item wording — only whether those exist. To read what was said in a meeting,
    fetch its transcript separately; that is a separate authorization each time.

    Two ways to state something false from this result:

    - For almost every caller the list is scoped to meetings where YOUR OWN email address
      appears in the participant list, so it is not a view of the organisation's meetings.
      An empty result means you were not recorded in any matching meeting — never report it
      as "there were no meetings about X", because meetings you did not attend are
      invisible here and their absence is not evidence. (One owner identity is exempt and
      sees everything; the response says which case applies, so read its caveats rather
      than assuming either.)
    - `hasTranscript: false` means nothing was captured, so no question about what was
      SAID in that meeting can be answered from this system. Do not infer content from the
      title; a title is what someone typed into a calendar invite.

    Participation is recorded per meeting from the calendar invite, so someone who joined
    without being invited, or was invited and never spoke, is counted the same way.
    """
    query = build_query(
        search=search,
        since=since,
        until=until,
        withTranscript=None if with_transcript is None else str(with_transcript).lower(),
        limit=limit,
    )
    return await anyio.to_thread.run_sync(partial(_meetings_sync, query))


def _export_link_sync(query: str) -> str:
    return _fibreflow_get_sync("/api/reporting/export-link", query)


@mcp.tool()
async def get_report_export(report: str, state: str = "open") -> str:
    """Get a short-lived URL that downloads a report as a CSV spreadsheet.

    - `report`: "action-items" or "meetings".
    - `state`: action-items only — "open" (default), "completed" or "all".

    Returns a URL, not the data. Give the URL to the person who asked; it opens in a
    browser or can be pasted into a spreadsheet's "import from web". Do not try to fetch
    it yourself and paste thousands of rows into the conversation — that is what the file
    is for.

    Two things to say plainly when you hand it over:

    - It expires in 15 minutes. That is deliberate, so a URL left in a chat thread is dead
      before anyone finds it. Ask again for a fresh one rather than treating an expired
      link as a fault.
    - It carries the SCOPE of whoever requested it, baked into the signature, and anyone
      holding the URL gets that same slice until it expires. So it is not something to
      post in a shared channel. For most callers the slice is "meetings you attended";
      the response says which case applies.

    The CSV covers up to 5,000 rows. If it is truncated the response header
    X-Export-Truncated says so — never describe a truncated export as the complete set.
    """
    query = build_query(report=report, state=state)
    return await anyio.to_thread.run_sync(partial(_export_link_sync, query))
