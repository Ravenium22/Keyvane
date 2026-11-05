"""Keyvane: license keys, plans, feature access and usage limits for software you sell."""

from .client import Entitlements, Keyvane, LicenseValidation, __version__
from .errors import (
    KeyvaneAPIError,
    KeyvaneAuthenticationError,
    KeyvaneConflictError,
    KeyvaneConnectionError,
    KeyvaneError,
    KeyvaneInvalidRequestError,
    KeyvaneNotFoundError,
    KeyvanePermissionError,
    KeyvaneRateLimitError,
)

__all__ = [
    "Keyvane",
    "Entitlements",
    "LicenseValidation",
    "KeyvaneError",
    "KeyvaneInvalidRequestError",
    "KeyvaneAuthenticationError",
    "KeyvanePermissionError",
    "KeyvaneNotFoundError",
    "KeyvaneConflictError",
    "KeyvaneRateLimitError",
    "KeyvaneAPIError",
    "KeyvaneConnectionError",
    "__version__",
]
