"""Regression tests for the live 1Map parent-account resolver."""

import asyncio
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.integrations import onemap_specialist_agent as onemap  # noqa: E402


def feature(prop_id, status, coordinates):
    return {
        "id": f"fibertime_installations.{prop_id}",
        "geometry": {"coordinates": coordinates},
        "properties": {
            "drp": "DR100",
            "site": "LAW",
            "status": status,
            "ph_ont": "ALCLB4TEST",
        },
    }


class Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = "response"

    def json(self):
        return self._payload


class ParentResolverTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_email = getattr(onemap, "RESOLVE_EMAIL", None)
        self.original_password = getattr(onemap, "RESOLVE_PASSWORD", None)
        self.original_token = onemap._RESOLVE_TOKEN
        self.original_lock = onemap._RESOLVE_LOCK
        onemap.RESOLVE_EMAIL = "resolver@example.test"
        onemap.RESOLVE_PASSWORD = "test-only-password"
        onemap._RESOLVE_TOKEN = None
        onemap._RESOLVE_LOCK = asyncio.Lock()
        self.agent = onemap.OneMapSpecialistAgent(
            email="primary@example.test",
            password="test-only-password",
        )

    def tearDown(self):
        onemap.RESOLVE_EMAIL = self.original_email
        onemap.RESOLVE_PASSWORD = self.original_password
        onemap._RESOLVE_TOKEN = self.original_token
        onemap._RESOLVE_LOCK = self.original_lock

    async def test_parent_resolver_precedes_web_fallback_and_keeps_all_properties(self):
        self.agent._request = AsyncMock(
            return_value={"result": {"geomResult": {"features": []}}},
        )
        self.agent._resolve_features = AsyncMock(
            return_value=[
                feature("101", "Home Sign Ups: Approved", [28.1, -26.1]),
                feature("102", "Home Installation: Installed", [28.1, -26.1]),
            ],
        )
        self.agent._web_get_dr = AsyncMock(return_value=None)

        record = await self.agent.get_dr("DR100")

        self.assertIsNotNone(record)
        self.assertEqual(len(record.property_records), 2)
        self.agent._resolve_features.assert_awaited_once_with("DR100")
        self.agent._web_get_dr.assert_not_awaited()

    async def test_resolver_reauthenticates_once_on_forbidden(self):
        self.agent._client = AsyncMock()
        self.agent._client.get = AsyncMock(
            side_effect=[
                Response(403, {}),
                Response(200, {"result": {"geomResult": {"features": [feature("101", "Installed", [])]}}}),
            ],
        )
        self.agent._resolve_authenticate = AsyncMock(side_effect=["old-token", "new-token"])

        features = await self.agent._resolve_features("DR100")

        self.assertEqual(len(features), 1)
        self.assertEqual(self.agent._client.get.await_count, 2)
        self.agent._resolve_authenticate.assert_any_await(
            force=True,
            rejected_token="old-token",
        )
        second_params = self.agent._client.get.await_args_list[1].kwargs["params"]
        self.assertEqual(second_params["token"], "new-token")

    async def test_concurrent_rejections_share_one_resolver_refresh(self):
        onemap._RESOLVE_TOKEN = (time.monotonic(), "rejected-token")
        self.agent._client = AsyncMock()
        self.agent._client.get = AsyncMock(
            return_value=Response(200, {"apiToken": {"token": "fresh-token"}}),
        )

        tokens = await asyncio.gather(
            self.agent._resolve_authenticate(
                force=True,
                rejected_token="rejected-token",
            ),
            self.agent._resolve_authenticate(
                force=True,
                rejected_token="rejected-token",
            ),
        )

        self.assertEqual(tokens, ["fresh-token", "fresh-token"])
        self.agent._client.get.assert_awaited_once()

    async def test_rejects_cql_injection_before_any_request(self):
        self.agent._request = AsyncMock()

        with self.assertRaisesRegex(ValueError, "alphanumeric"):
            await self.agent.get_dr("DR100' OR '1'='1")

        self.agent._request.assert_not_awaited()

    async def test_rejects_injection_shaped_search_before_any_request(self):
        self.agent._request = AsyncMock()

        with self.assertRaisesRegex(ValueError, "alphanumerics"):
            await self.agent.search_dr("DR100%' OR '1'='1")

        self.agent._request.assert_not_awaited()

    def test_parse_feature_rejects_partial_null_coordinates(self):
        record = self.agent._parse_feature(
            feature("101", "Home Sign Ups: Approved", [28.1, None]),
        )

        self.assertIsNone(record.coordinates)

    def test_parse_feature_accepts_null_geometry_as_missing_gps(self):
        raw_feature = feature("101", "Home Sign Ups: Approved", [])
        raw_feature["geometry"] = None

        record = self.agent._parse_feature(raw_feature)

        self.assertIsNone(record.coordinates)

    def test_compose_pins_only_loopback_and_velocity_tailscale(self):
        compose_path = Path(__file__).resolve().parent.parent / "compose.example.yml"
        compose = compose_path.read_text()

        self.assertIn('"127.0.0.1:8003:8001"', compose)
        self.assertIn('"100.96.203.105:8003:8001"', compose)
        self.assertNotIn("DR_PHOTO_BIND_ADDRESS", compose)
        self.assertNotIn('"0.0.0.0:8003:8001"', compose)
        self.assertIn("DR_PHOTO_API_IMAGE_ID", compose)
        self.assertNotIn("DR_PHOTO_API_IMAGE_TAG", compose)


if __name__ == "__main__":
    unittest.main()
