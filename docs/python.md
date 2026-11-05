# Python SDK

`keyvane` is the Python client for Keyvane. It uses only the standard library, supports Python 3.9+, and mirrors the [JavaScript SDK](sdk.md): the same resources, helpers, errors and retry rules. AI tools, FastAPI and Django apps are the typical users.

```bash
pip install keyvane
```


## Configure

```python
from keyvane import Keyvane

kv = Keyvane(
    api_key="kv_sk_...",                         # or KEYVANE_SECRET_KEY
    base_url="https://keyvane.example.com",    # or KEYVANE_URL
    timeout=10.0,
    max_retries=2,
)
```

## Gate features and meter usage (FastAPI)

```python
from fastapi import Depends, FastAPI, HTTPException
from keyvane import Keyvane, KeyvaneConnectionError

app = FastAPI()
kv = Keyvane()

@app.post("/v1/summaries")
def summarize(doc: Document, user: User = Depends(current_user)):
    try:
        usage = kv.usage.record(customer=user.id, feature="ai_requests", idempotency_key=doc.id)
    except KeyvaneConnectionError:
        raise HTTPException(503, "Plan check unavailable, try again")
    if not usage["allowed"]:
        raise HTTPException(402, usage["message"])  # 'limit_exceeded' or 'not_included'
    return run_model(doc)

@app.get("/v1/exports/{export_id}")
def export(export_id: str, user: User = Depends(current_user)):
    if not kv.entitlements.get(customer=user.id).can("export"):
        raise HTTPException(403, "Export is available on Pro")
    ...
```

## Reference

| Call | Returns |
|---|---|
| `kv.entitlements.get(customer=, product=None)` | `Entitlements` with `.plan_key`, `.can(key, quantity=1)`, `.remaining(key)`, `.limit(key)`, `.used(key)`, `.is_on_plan(*keys)`, `.data` |
| `kv.entitlements.check(customer=, feature=, product=None, quantity=None)` | `dict` with `allowed`, `code`, `message` |
| `kv.usage.record(feature=, customer=None, license_key=None, quantity=None, idempotency_key=None)` | `dict` with `allowed`, `code`, `feature` (never raises at the limit) |
| `kv.customers.upsert / retrieve / update / list / delete` | Customer `dict`s |
| `kv.licenses.create(plan=, customer=, duration_days=, max_activations=, ...)` | License `dict` |
| `kv.licenses.validate / activate(key=, fingerprint=)` | `LicenseValidation` with `.valid`, `.code`, `.message`, `.license`, `.entitlements` |
| `kv.licenses.deactivate / retrieve / list / update / suspend / reinstate / revoke` | `dict`s |
| `kv.products.list() / retrieve(id_or_key)` | Product `dict`s |

Responses are the [REST API](api-reference.md) objects as dictionaries.

## Errors

`KeyvaneError` is the base class. Subclasses: `KeyvaneInvalidRequestError` (400), `KeyvaneAuthenticationError` (401), `KeyvanePermissionError` (403), `KeyvaneNotFoundError` (404), `KeyvaneConflictError` (409), `KeyvaneRateLimitError` (429), `KeyvaneAPIError` (5xx) and `KeyvaneConnectionError` (network or timeout). Each has `status`, `code`, `type`, `param` and `request_id`.

GET requests, `customers.upsert`, license validation/activation/deactivation, and usage records with an `idempotency_key` are retried on network errors, 429 and 5xx with exponential backoff.
