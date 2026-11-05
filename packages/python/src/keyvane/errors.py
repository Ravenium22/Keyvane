"""Exceptions raised by the Keyvane SDK. Mirrors the JavaScript SDK."""

from __future__ import annotations

from typing import Any, Optional


class KeyvaneError(Exception):
    """Base class for every error raised by the SDK."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        type: Optional[str] = None,
        code: Optional[str] = None,
        param: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.type = type
        self.code = code
        self.param = param
        self.request_id = request_id


class KeyvaneInvalidRequestError(KeyvaneError):
    """400: a parameter is missing or invalid."""


class KeyvaneAuthenticationError(KeyvaneError):
    """401: the API key is missing, wrong or revoked."""


class KeyvanePermissionError(KeyvaneError):
    """403: e.g. a publishable key was used on a secret-key endpoint."""


class KeyvaneNotFoundError(KeyvaneError):
    """404: unknown customer, license, product, plan or feature."""


class KeyvaneConflictError(KeyvaneError):
    """409: the request conflicts with the current state."""


class KeyvaneRateLimitError(KeyvaneError):
    """429: too many requests."""


class KeyvaneAPIError(KeyvaneError):
    """5xx: Keyvane had a problem."""


class KeyvaneConnectionError(KeyvaneError):
    """The API could not be reached (network error or timeout)."""


_BY_STATUS = {
    400: KeyvaneInvalidRequestError,
    413: KeyvaneInvalidRequestError,
    401: KeyvaneAuthenticationError,
    403: KeyvanePermissionError,
    404: KeyvaneNotFoundError,
    409: KeyvaneConflictError,
    429: KeyvaneRateLimitError,
}


def error_from_response(status: int, body: Any, request_id: Optional[str]) -> KeyvaneError:
    err = body.get("error", {}) if isinstance(body, dict) else {}
    message = err.get("message") or f"Keyvane API responded with HTTP {status}."
    cls = _BY_STATUS.get(status) or (KeyvaneAPIError if status >= 500 else KeyvaneError)
    return cls(message, status=status, type=err.get("type"), code=err.get("code"), param=err.get("param"), request_id=request_id)
