"""Tests for view_photo: the guards it inherits, and the decode it owns.

The point of most of these is that view_photo reaches FibreFlow through the SAME guard
as fibreflow_get. A second fetch path is exactly where a denylist quietly stops
applying, so the denied-group and traversal cases are re-asserted here against the new
entry point rather than assumed from test_guards.py.

Run with:  FF_MCP_CALLBACK_SECRET=test-secret python3 -m pytest apps/ff_mcp/ -q
"""

from __future__ import annotations

import io
import random

import pytest
from PIL import Image as PilImage

@pytest.fixture()
def photos(svc):
    """The photo_tools module, imported against the same isolated service as `svc`."""
    import importlib

    _, tools = svc
    return importlib.import_module("ff_mcp.photo_tools"), tools


# Not a credential — a placeholder the fake urlopen echoes back. Kept as a named
# constant so the repo secret scanner does not read `token="..."` as a real literal.
FAKE_TOKEN = "placeholder-not-a-credential"


def _with_token(photo_tools, tools, monkeypatch, token=FAKE_TOKEN):
    """Patch the binding photo_tools actually calls.

    photo_tools imports _access_token by value, so patching tools._access_token (what
    test_tools does) leaves this module holding the original. The rate limiter is
    imported the same way but mutates tools._call_times, so that state stays shared —
    which is the point of the budget test below.
    """
    monkeypatch.setattr(photo_tools, "_access_token", lambda: token)
    tools._call_times.clear()


def _jpeg(width: int, height: int, exif: bytes | None = None) -> bytes:
    """A real JPEG, not a stub — the code under test runs a real decoder over it."""
    img = PilImage.new("RGB", (width, height), (10, 120, 200))
    buf = io.BytesIO()
    if exif is None:
        img.save(buf, format="JPEG")
    else:
        img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def _fake_response(photo_tools, monkeypatch, body: bytes, content_type: str = "image/jpeg"):
    class FakeResp:
        headers = {"Content-Type": content_type}

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, n=-1):
            return body[:n] if n and n > 0 else body

    monkeypatch.setattr(
        photo_tools.urllib.request, "urlopen", lambda req, timeout=0: FakeResp()
    )


@pytest.mark.parametrize(
    "denied",
    [
        "/api/accounting/ledger",
        "/api/staff/list",
        "/api/staff-documents/1",
        "/api/meetings",
        "/api/procurement/purchase-orders",
        "/api/action-items",
    ],
)
def test_view_photo_refuses_denied_groups(photos, monkeypatch, denied):
    """The denylist must hold on the image path too, not just the text one."""
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    monkeypatch.setattr(
        photo_tools.urllib.request,
        "urlopen",
        lambda req, timeout=0: pytest.fail(f"denylist bypassed: {req.full_url}"),
    )

    with pytest.raises(photo_tools.PhotoFetchError) as err:
        photo_tools._view_photo_sync(denied, "", 1568)
    assert "do not try other paths" in str(err.value)


@pytest.mark.parametrize(
    "bad",
    ["https://evil.example/api/photo", "/api/../../etc/passwd", "/api/%2e%2e/x", "/dashboard"],
)
def test_view_photo_refuses_paths_the_text_tool_refuses(photos, monkeypatch, bad):
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    monkeypatch.setattr(
        photo_tools.urllib.request,
        "urlopen",
        lambda req, timeout=0: pytest.fail(f"guard bypassed: {req.full_url}"),
    )

    with pytest.raises(photo_tools.PhotoFetchError):
        photo_tools._view_photo_sync(bad, "", 1568)


def test_view_photo_spends_the_same_hourly_budget_as_fibreflow_get(photos, monkeypatch):
    """A photo read is a read. If it skipped the limiter, an agent could loop on images."""
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    _fake_response(photo_tools, monkeypatch, _jpeg(200, 150))

    photo_tools._view_photo_sync("/api/construction-qa/photo-proxy", "key=a", 1568)

    assert sum(len(v) for v in tools._call_times.values()) == 1


def test_view_photo_downscales_to_the_ceiling(photos, monkeypatch):
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    _fake_response(photo_tools, monkeypatch, _jpeg(4000, 3000))

    result = photo_tools._view_photo_sync("/api/qfield/photo-proxy", "key=x", 9999)

    with PilImage.open(io.BytesIO(result.data)) as out:
        assert max(out.size) == photo_tools.MAX_DIMENSION
        assert out.size == (1568, 1176)  # aspect ratio preserved, not squashed


def test_view_photo_clamps_a_tiny_max_dimension_up(photos, monkeypatch):
    """A model asking for 32px would produce an image nobody can read anything in."""
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    _fake_response(photo_tools, monkeypatch, _jpeg(4000, 3000))

    result = photo_tools._view_photo_sync("/api/qfield/photo-proxy", "key=x", 32)

    with PilImage.open(io.BytesIO(result.data)) as out:
        assert max(out.size) == photo_tools.MIN_DIMENSION


def test_view_photo_does_not_upscale_a_small_photo(photos, monkeypatch):
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    _fake_response(photo_tools, monkeypatch, _jpeg(320, 240))

    result = photo_tools._view_photo_sync("/api/qfield/photo-proxy", "key=x", 1568)

    with PilImage.open(io.BytesIO(result.data)) as out:
        assert out.size == (320, 240)


def test_render_passes_through_when_reencoding_would_inflate(photos):
    """Measured on real QField photos: q90 re-encode took 388 KB to 623 KB.

    Those arrive already resized and compressed harder than JPEG_QUALITY, so the
    re-encode bought a bigger payload and a second generation of artefacts for an
    image of identical dimensions.
    """
    photo_tools, _tools = photos
    img = PilImage.new("RGB", (800, 600))
    for x in range(800):  # detail, so the encoder cannot trivially flatten it
        for y in range(0, 600, 3):
            img.putpixel((x, y), ((x * 7) % 256, (y * 13) % 256, (x + y) % 256))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=30)
    original = buf.getvalue()

    result = photo_tools._render(original, 1568)

    assert result is original, "re-encoded a photo that was already smaller"


def test_render_passes_through_a_photo_only_just_over_the_ceiling(photos):
    """QField photos are 1600px against a 1568px budget — 2% over.

    Shaving those 32 pixels costs a full re-encode, and measured on real photos it
    INFLATED them. Claude resamples above 1568 itself, so the crop buys nothing.
    """
    photo_tools, _tools = photos
    img = PilImage.new("RGB", (1200, 1600))
    for x in range(0, 1200, 2):
        for y in range(0, 1600, 3):
            img.putpixel((x, y), ((x * 7) % 256, (y * 13) % 256, (x + y) % 256))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=30)
    original = buf.getvalue()

    result = photo_tools._render(original, 1568)

    assert result is original


def test_render_downscales_an_oversize_photo_even_when_the_reencode_is_bigger(photos):
    """Pins PASSTHROUGH_SLACK: without it, this photo is forwarded at 2400px.

    Every other conjunct of `already_optimal` holds here — JPEG, no rotation, and the
    re-encode really is larger (465 KB -> 1027 KB measured) — so `fits_budget` is the
    only thing making this photo get downscaled at all. A noisy image stored at low
    quality is exactly that shape: bytes go UP while pixels go DOWN.
    """
    photo_tools, _tools = photos
    noise = random.Random(20260812).randbytes(2400 * 1800 * 3)
    buf = io.BytesIO()
    PilImage.frombytes("RGB", (2400, 1800), noise).save(buf, format="JPEG", quality=10)
    original = buf.getvalue()

    result = photo_tools._render(original, 1568)

    assert result is not original, "forwarded a 2400px photo — PASSTHROUGH_SLACK is inert"
    with PilImage.open(io.BytesIO(result)) as out:
        assert out.size == (1568, 1176)
    assert len(result) > len(original), "fixture no longer exercises the inflating case"


def test_render_rotates_even_when_the_reencode_is_bigger(photos):
    """Pins the `not needs_rotation` conjunct of already_optimal.

    Without it this photo passes through un-rotated: it is JPEG, within budget, and its
    re-encode inflates (79 KB -> 126 KB measured). A sideways trench photo is one a model
    reads WRONG rather than refuses, so the rotation must win over the byte-size test.
    """
    photo_tools, _tools = photos
    img = PilImage.new("RGB", (800, 600))
    for x in range(800):
        for y in range(0, 600, 3):
            img.putpixel((x, y), ((x * 7) % 256, (y * 13) % 256, (x + y) % 256))
    exif = PilImage.Exif()
    exif[0x0112] = 6  # rotate 90°
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=30, exif=exif.tobytes())
    original = buf.getvalue()

    result = photo_tools._render(original, 1568)

    assert result is not original, "passed through un-rotated pixels"
    with PilImage.open(io.BytesIO(result)) as out:
        assert out.size == (600, 800), "EXIF rotation lost to the size comparison"
    assert len(result) > len(original), "fixture no longer exercises the inflating case"


def test_render_still_downscales_an_oversize_photo_that_compresses_well(photos):
    """The pass-through must not swallow the downscale — only skip a pointless re-encode."""
    photo_tools, _tools = photos
    buf = io.BytesIO()
    PilImage.new("RGB", (4000, 3000), (5, 5, 5)).save(buf, format="JPEG", quality=95)
    original = buf.getvalue()

    result = photo_tools._render(original, 1568)

    with PilImage.open(io.BytesIO(result)) as out:
        assert max(out.size) == 1568


def test_view_photo_applies_exif_rotation(photos, monkeypatch):
    """Orientation 6 means 'rotate 90°'. A sideways trench photo gets misread, not refused."""
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    exif = PilImage.Exif()
    exif[0x0112] = 6  # Orientation
    _fake_response(photo_tools, monkeypatch, _jpeg(400, 200, exif=exif.tobytes()))

    result = photo_tools._view_photo_sync("/api/qfield/photo-proxy", "key=x", 1568)

    with PilImage.open(io.BytesIO(result.data)) as out:
        assert out.size == (200, 400), "EXIF orientation was not applied"


def test_view_photo_surfaces_a_json_error_body_verbatim(photos, monkeypatch):
    """Routes answer 200 + JSON for a missing key. The model can act on that message."""
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    _fake_response(
        photo_tools,
        monkeypatch,
        b'{"error":{"message":"Photo key parameter required"}}',
        content_type="application/json",
    )

    with pytest.raises(photo_tools.PhotoFetchError) as err:
        photo_tools._view_photo_sync("/api/construction-qa/photo-proxy", "", 1568)
    assert "Photo key parameter required" in str(err.value)


def test_view_photo_rejects_bytes_that_are_not_an_image(photos, monkeypatch):
    """Content-Type can lie; the decoder is the thing that actually knows."""
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    _fake_response(photo_tools, monkeypatch, b"not a jpeg at all", content_type="image/jpeg")

    with pytest.raises(photo_tools.PhotoFetchError) as err:
        photo_tools._view_photo_sync("/api/qfield/photo-proxy", "key=x", 1568)
    assert "could not be decoded" in str(err.value)


def test_view_photo_refuses_an_oversize_body(photos, monkeypatch):
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    monkeypatch.setattr(photo_tools, "MAX_SOURCE_BYTES", 1024)
    _fake_response(photo_tools, monkeypatch, b"\xff\xd8" + b"x" * 4096)

    with pytest.raises(photo_tools.PhotoFetchError) as err:
        photo_tools._view_photo_sync("/api/qfield/photo-proxy", "key=x", 1568)
    assert "not a single photo" in str(err.value)


def test_view_photo_sends_the_bearer_token_and_a_cloudflare_safe_user_agent(photos, monkeypatch):
    """The User-Agent is load-bearing: Cloudflare 1010s the default Python one."""
    photo_tools, tools = photos
    _with_token(photo_tools, tools, monkeypatch)
    seen = {}

    class FakeResp:
        headers = {"Content-Type": "image/jpeg"}

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, n=-1):
            return _jpeg(100, 100)

    def capture(req, timeout=0):
        seen["url"] = req.full_url
        seen["auth"] = req.get_header("Authorization")
        seen["ua"] = req.get_header("User-agent")
        return FakeResp()

    monkeypatch.setattr(photo_tools.urllib.request, "urlopen", capture)
    photo_tools._view_photo_sync("/api/qfield/photo-proxy", "key=projects/a/b.jpg", 1568)

    assert seen["url"] == (
        "https://dev.fibreflow.app/api/qfield/photo-proxy?key=projects/a/b.jpg"
    )
    assert seen["auth"] == "Bearer " + FAKE_TOKEN
    assert seen["ua"] == "ff-remote-mcp/0.1"


def test_view_photo_without_a_credential_explains_how_to_reconnect(photos, monkeypatch):
    """No _with_token here on purpose — this exercises the real _access_token."""
    photo_tools, _tools = photos
    monkeypatch.setattr(
        photo_tools.urllib.request,
        "urlopen",
        lambda req, timeout=0: pytest.fail("fetched without a credential"),
    )

    with pytest.raises(RuntimeError) as err:
        photo_tools._view_photo_sync("/api/qfield/photo-proxy", "key=x", 1568)
    assert "Reconnect the FibreFlow connector" in str(err.value)
