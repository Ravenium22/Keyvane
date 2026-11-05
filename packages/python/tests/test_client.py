"""Unit tests against a stub HTTP server, plus an optional live test (KEYVANE_TEST_URL)."""

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from keyvane import (  # noqa: E402
    Entitlements,
    Keyvane,
    KeyvaneAuthenticationError,
    KeyvaneConnectionError,
    KeyvaneError,
    KeyvaneNotFoundError,
)

ENTITLEMENTS = {
    "object": "entitlements",
    "plan": {"id": "pln_1", "key": "free", "name": "Free"},
    "source": "default_plan",
    "features": {
        "export": {"name": "Export", "type": "boolean", "enabled": False},
        "pdf_analysis": {"name": "PDF analyses", "type": "metered", "enabled": True, "limit": 10, "used": 3, "remaining": 7},
    },
}


class Stub(BaseHTTPRequestHandler):
    requests = []  # (method, path, headers, body)
    responses = []  # queue of (status, body, headers)

    def _handle(self):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode() if length else ""
        Stub.requests.append((self.command, self.path, dict(self.headers), body))
        status, payload, headers = Stub.responses.pop(0) if Stub.responses else (200, {}, {})
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("x-request-id", "req_test")
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PATCH = do_DELETE = _handle

    def log_message(self, *args):
        pass


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        Stub.requests.clear()
        Stub.responses.clear()
        self.kv = Keyvane(api_key="kv_sk_test", base_url=self.base + "/", max_retries=2)

    def test_requires_key_and_url(self):
        os.environ.pop("KEYVANE_SECRET_KEY", None)
        with self.assertRaises(KeyvaneError):
            Keyvane(base_url="http://x")
        with self.assertRaises(KeyvaneError):
            Keyvane(api_key="kv_sk_x", base_url=None)

    def test_entitlements_helpers_and_auth_header(self):
        Stub.responses.append((200, ENTITLEMENTS, {}))
        access = self.kv.entitlements.get(customer="user 42")
        self.assertIsInstance(access, Entitlements)
        method, path, headers, _ = Stub.requests[0]
        self.assertEqual(method, "GET")
        self.assertEqual(path, "/v1/entitlements?customer=user+42")
        self.assertEqual(headers["Authorization"], "Bearer kv_sk_test")
        self.assertEqual(access.plan_key, "free")
        self.assertFalse(access.can("export"))
        self.assertTrue(access.can("pdf_analysis", 7))
        self.assertFalse(access.can("pdf_analysis", 8))
        self.assertEqual(access.remaining("pdf_analysis"), 7)
        self.assertEqual(access.remaining("export"), 0)
        self.assertEqual(access.used("pdf_analysis"), 3)
        self.assertTrue(access.is_on_plan("free", "pro"))
        self.assertFalse(access.can("unknown"))

    def test_usage_sends_json_and_idempotency_header(self):
        Stub.responses.append((200, {"object": "usage", "allowed": False, "code": "limit_exceeded"}, {}))
        result = self.kv.usage.record(customer="u1", feature="pdf_analysis", idempotency_key="job-1")
        self.assertFalse(result["allowed"])
        method, path, headers, body = Stub.requests[0]
        self.assertEqual((method, path), ("POST", "/v1/usage"))
        self.assertEqual(json.loads(body), {"customer": "u1", "feature": "pdf_analysis", "idempotency_key": "job-1"})
        self.assertEqual(headers["Idempotency-Key"], "job-1")

    def test_retries_safe_requests_on_5xx(self):
        Stub.responses.extend([(503, {"error": {"message": "busy"}}, {}), (200, {"object": "list", "data": [], "has_more": False}, {})])
        self.assertEqual(self.kv.products.list()["data"], [])
        self.assertEqual(len(Stub.requests), 2)

    def test_does_not_retry_unsafe_writes(self):
        Stub.responses.extend([(500, {"error": {"message": "boom"}}, {}), (200, {}, {})])
        with self.assertRaises(KeyvaneError):
            self.kv.usage.record(customer="u1", feature="f")
        self.assertEqual(len(Stub.requests), 1)

    def test_maps_errors(self):
        Stub.responses.append((401, {"error": {"type": "authentication_error", "code": "invalid_api_key", "message": "Invalid API key."}}, {}))
        with self.assertRaises(KeyvaneAuthenticationError) as ctx:
            self.kv.products.list()
        self.assertEqual(ctx.exception.status, 401)
        self.assertEqual(ctx.exception.code, "invalid_api_key")
        self.assertEqual(ctx.exception.request_id, "req_test")
        Stub.responses.append((404, {"error": {"code": "feature_not_found", "message": "Feature not found."}}, {}))
        with self.assertRaises(KeyvaneNotFoundError):
            self.kv.entitlements.check(customer="u", feature="nope")

    def test_connection_errors(self):
        dead = Keyvane(api_key="kv_sk_x", base_url="http://127.0.0.1:9", max_retries=0, timeout=2)
        with self.assertRaises(KeyvaneConnectionError):
            dead.products.list()

    def test_license_validation_wrapper(self):
        Stub.responses.append((200, {"object": "license_validation", "valid": True, "code": "valid", "message": "ok", "license": {"key": "KV-1"}, "entitlements": ENTITLEMENTS}, {}))
        result = self.kv.licenses.validate(key="KV-1", fingerprint="m1")
        self.assertTrue(result.valid)
        self.assertEqual(result.entitlements.plan_key, "free")
        self.assertEqual(json.loads(Stub.requests[0][3]), {"key": "KV-1", "fingerprint": "m1"})


class PackagingTest(unittest.TestCase):
    def test_version_matches_pyproject(self):
        import re

        from keyvane import __version__

        pyproject = os.path.join(os.path.dirname(__file__), "..", "pyproject.toml")
        with open(pyproject, encoding="utf-8") as f:
            match = re.search(r'^version = "([^"]+)"', f.read(), re.MULTILINE)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), __version__)


@unittest.skipUnless(os.environ.get("KEYVANE_TEST_URL") and os.environ.get("KEYVANE_TEST_SECRET_KEY"), "set KEYVANE_TEST_URL and KEYVANE_TEST_SECRET_KEY for the live test")
class LiveTest(unittest.TestCase):
    def test_round_trip(self):
        kv = Keyvane(api_key=os.environ["KEYVANE_TEST_SECRET_KEY"], base_url=os.environ["KEYVANE_TEST_URL"])
        kv.customers.upsert(external_id="py_live_user", email="py@example.com")
        access = kv.entitlements.get(customer="py_live_user")
        self.assertIsNotNone(access.plan_key)
        usage = kv.usage.record(customer="py_live_user", feature="pdf_analysis", idempotency_key="py-live-1")
        self.assertIn(usage["code"], ("ok", "limit_exceeded"))
        license = kv.licenses.create(plan="pro", customer="py_live_user", duration_days=1)
        self.assertTrue(kv.licenses.validate(key=license["key"]).valid)
        kv.licenses.revoke(license["id"], reason="python live test")
        self.assertEqual(kv.licenses.validate(key=license["key"]).code, "revoked")
        self.assertTrue(kv.customers.delete("py_live_user")["deleted"])


if __name__ == "__main__":
    unittest.main()
