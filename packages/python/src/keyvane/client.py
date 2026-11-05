"""Keyvane Python SDK. Zero dependencies; uses the standard library only."""

from __future__ import annotations

import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from .errors import KeyvaneConnectionError, KeyvaneError, error_from_response

__version__ = "0.1.0"

Json = Dict[str, Any]


def _compact(params: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in params.items() if v is not None}


class Entitlements:
    """What a customer may do right now, with helpers mirroring the JS SDK."""

    def __init__(self, data: Json) -> None:
        self.data = data

    @property
    def plan(self) -> Optional[Json]:
        return self.data.get("plan")

    @property
    def plan_key(self) -> Optional[str]:
        return (self.data.get("plan") or {}).get("key")

    @property
    def source(self) -> str:
        return self.data.get("source", "none")

    @property
    def features(self) -> Dict[str, Json]:
        return self.data.get("features", {})

    def feature(self, key: str) -> Optional[Json]:
        return self.features.get(key)

    def can(self, key: str, quantity: int = 1) -> bool:
        """True if the feature is included and, for metered features, `quantity` units remain."""
        f = self.features.get(key)
        if not f or not f.get("enabled"):
            return False
        if f.get("type") == "boolean":
            return True
        remaining = f.get("remaining")
        return remaining is None or remaining >= quantity

    def remaining(self, key: str) -> Optional[int]:
        """Units left this period: None = unlimited, 0 when not included."""
        f = self.features.get(key)
        if not f or not f.get("enabled"):
            return 0
        if f.get("type") == "boolean":
            return None
        return f.get("remaining")

    def limit(self, key: str) -> Optional[int]:
        f = self.features.get(key)
        if not f or not f.get("enabled"):
            return 0
        return f.get("limit") if f.get("type") == "metered" else None

    def used(self, key: str) -> int:
        f = self.features.get(key) or {}
        return int(f.get("used", 0)) if f.get("type") == "metered" else 0

    def is_on_plan(self, *plan_keys: str) -> bool:
        return self.plan_key in plan_keys

    def __repr__(self) -> str:
        return f"<Entitlements plan={self.plan_key!r} source={self.source!r}>"


class LicenseValidation:
    def __init__(self, data: Json) -> None:
        self.data = data
        self.entitlements = Entitlements(data["entitlements"]) if data.get("entitlements") else None

    @property
    def valid(self) -> bool:
        return bool(self.data.get("valid"))

    @property
    def code(self) -> str:
        return self.data.get("code", "")

    @property
    def message(self) -> str:
        return self.data.get("message", "")

    @property
    def license(self) -> Optional[Json]:
        return self.data.get("license")

    @property
    def activation(self) -> Optional[Json]:
        return self.data.get("activation")

    def __repr__(self) -> str:
        return f"<LicenseValidation valid={self.valid} code={self.code!r}>"


class Keyvane:
    """
    kv = Keyvane(api_key="kv_sk_...", base_url="https://keyvane.example.com")

    Defaults to the KEYVANE_SECRET_KEY (or KEYVANE_PUBLISHABLE_KEY) and KEYVANE_URL
    environment variables.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        *,
        timeout: float = 10.0,
        max_retries: int = 2,
    ) -> None:
        api_key = api_key or os.environ.get("KEYVANE_SECRET_KEY") or os.environ.get("KEYVANE_PUBLISHABLE_KEY")
        base_url = base_url or os.environ.get("KEYVANE_URL")
        if not api_key:
            raise KeyvaneError("Missing API key. Pass api_key or set KEYVANE_SECRET_KEY.")
        if not base_url:
            raise KeyvaneError("Missing base URL. Pass base_url (e.g. https://keyvane.example.com) or set KEYVANE_URL.")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        if self._base_url.endswith("/v1"):
            self._base_url = self._base_url[:-3]
        self._timeout = timeout
        self._max_retries = max(0, max_retries)
        self.customers = _Customers(self)
        self.entitlements = _Entitlements(self)
        self.usage = _Usage(self)
        self.licenses = _Licenses(self)
        self.products = _Products(self)

    def request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
        retry: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> Json:
        url = f"{self._base_url}/v1{path}"
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self._api_key}", "Accept": "application/json", "User-Agent": f"keyvane-python/{__version__}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        can_retry = retry if retry is not None else method == "GET"

        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as res:
                    payload = res.read()
                    return json.loads(payload) if payload else {}
            except urllib.error.HTTPError as err:
                request_id = err.headers.get("x-request-id") if err.headers else None
                try:
                    parsed = json.loads(err.read() or b"{}")
                except ValueError:
                    parsed = {}
                retryable = err.code == 429 or err.code >= 500
                if can_retry and retryable and attempt < self._max_retries:
                    retry_after = err.headers.get("retry-after") if err.headers else None
                    self._sleep(attempt, retry_after)
                    attempt += 1
                    continue
                raise error_from_response(err.code, parsed, request_id) from None
            except (urllib.error.URLError, TimeoutError, OSError) as err:
                if can_retry and attempt < self._max_retries:
                    self._sleep(attempt, None)
                    attempt += 1
                    continue
                raise KeyvaneConnectionError(f"Could not reach Keyvane at {self._base_url}: {err}") from err

    @staticmethod
    def _sleep(attempt: int, retry_after: Optional[str]) -> None:
        try:
            seconds = float(retry_after) if retry_after else 0.0
        except ValueError:
            seconds = 0.0
        time.sleep(min(seconds, 10.0) if seconds > 0 else min(0.25 * 2**attempt, 4.0) + random.random() * 0.1)


class _Customers:
    def __init__(self, client: Keyvane) -> None:
        self._c = client

    def upsert(self, *, external_id: str, email: Optional[str] = None, name: Optional[str] = None, metadata: Optional[Json] = None) -> Json:
        return self._c.request("POST", "/customers", body=_compact({"external_id": external_id, "email": email, "name": name, "metadata": metadata}), retry=True)

    def retrieve(self, id_or_external_id: str) -> Json:
        return self._c.request("GET", f"/customers/{urllib.parse.quote(id_or_external_id, safe='')}")

    def update(self, id_or_external_id: str, **fields: Any) -> Json:
        return self._c.request("PATCH", f"/customers/{urllib.parse.quote(id_or_external_id, safe='')}", body=_compact(fields))

    def list(self, *, limit: Optional[int] = None, starting_after: Optional[str] = None, email: Optional[str] = None, query: Optional[str] = None) -> Json:
        return self._c.request("GET", "/customers", query=_compact({"limit": limit, "starting_after": starting_after, "email": email, "query": query}))

    def delete(self, id_or_external_id: str) -> Json:
        return self._c.request("DELETE", f"/customers/{urllib.parse.quote(id_or_external_id, safe='')}")


class _Entitlements:
    def __init__(self, client: Keyvane) -> None:
        self._c = client

    def get(self, *, customer: str, product: Optional[str] = None) -> Entitlements:
        return Entitlements(self._c.request("GET", "/entitlements", query=_compact({"customer": customer, "product": product})))

    def check(self, *, customer: str, feature: str, product: Optional[str] = None, quantity: Optional[int] = None) -> Json:
        return self._c.request("GET", "/entitlements/check", query=_compact({"customer": customer, "feature": feature, "product": product, "quantity": quantity}))


class _Usage:
    def __init__(self, client: Keyvane) -> None:
        self._c = client

    def record(
        self,
        *,
        feature: str,
        customer: Optional[str] = None,
        license_key: Optional[str] = None,
        product: Optional[str] = None,
        quantity: Optional[int] = None,
        idempotency_key: Optional[str] = None,
    ) -> Json:
        """Check the limit and consume atomically. Returns allowed=False (does not raise) at the limit."""
        body = _compact({"customer": customer, "license_key": license_key, "feature": feature, "product": product, "quantity": quantity, "idempotency_key": idempotency_key})
        return self._c.request("POST", "/usage", body=body, idempotency_key=idempotency_key, retry=bool(idempotency_key))


class _Licenses:
    def __init__(self, client: Keyvane) -> None:
        self._c = client

    def create(self, *, plan: str, **fields: Any) -> Json:
        return self._c.request("POST", "/licenses", body=_compact({"plan": plan, **fields}))

    def retrieve(self, license_id: str) -> Json:
        return self._c.request("GET", f"/licenses/{urllib.parse.quote(license_id, safe='')}")

    def list(self, **filters: Any) -> Json:
        return self._c.request("GET", "/licenses", query=_compact(filters))

    def update(self, license_id: str, **fields: Any) -> Json:
        return self._c.request("PATCH", f"/licenses/{urllib.parse.quote(license_id, safe='')}", body=fields)

    def suspend(self, license_id: str, reason: Optional[str] = None) -> Json:
        return self._c.request("POST", f"/licenses/{urllib.parse.quote(license_id, safe='')}/suspend", body=_compact({"reason": reason}))

    def reinstate(self, license_id: str) -> Json:
        return self._c.request("POST", f"/licenses/{urllib.parse.quote(license_id, safe='')}/reinstate", body={})

    def revoke(self, license_id: str, reason: Optional[str] = None) -> Json:
        return self._c.request("POST", f"/licenses/{urllib.parse.quote(license_id, safe='')}/revoke", body=_compact({"reason": reason}))

    def validate(self, *, key: str, fingerprint: Optional[str] = None, product: Optional[str] = None) -> LicenseValidation:
        return LicenseValidation(self._c.request("POST", "/licenses/validate", body=_compact({"key": key, "fingerprint": fingerprint, "product": product}), retry=True))

    def activate(self, *, key: str, fingerprint: str, name: Optional[str] = None, product: Optional[str] = None) -> LicenseValidation:
        return LicenseValidation(self._c.request("POST", "/licenses/activate", body=_compact({"key": key, "fingerprint": fingerprint, "name": name, "product": product}), retry=True))

    def deactivate(self, *, key: str, fingerprint: str) -> Json:
        return self._c.request("POST", "/licenses/deactivate", body={"key": key, "fingerprint": fingerprint}, retry=True)


class _Products:
    def __init__(self, client: Keyvane) -> None:
        self._c = client

    def list(self) -> Json:
        return self._c.request("GET", "/products")

    def retrieve(self, id_or_key: str) -> Json:
        return self._c.request("GET", f"/products/{urllib.parse.quote(id_or_key, safe='')}")


__all__: List[str] = ["Keyvane", "Entitlements", "LicenseValidation", "__version__"]
