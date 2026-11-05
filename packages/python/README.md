# keyvane (Python)

Python SDK for [Keyvane](https://github.com/Ravenium22/Keyvane): license keys, plans, feature access and usage limits for software you sell, kept in sync with Stripe. Standard library only; Python 3.9+.

```bash
pip install keyvane
```

```python
from keyvane import Keyvane

kv = Keyvane()  # KEYVANE_URL and KEYVANE_SECRET_KEY from the environment

kv.customers.upsert(external_id=user.id, email=user.email)

access = kv.entitlements.get(customer=user.id)
if not access.can("export"):
    raise PermissionError("Export is on the Pro plan")

usage = kv.usage.record(customer=user.id, feature="ai_requests", idempotency_key=request_id)
if not usage["allowed"]:
    return {"error": usage["message"]}, 402
```

Full documentation: [docs/python.md](https://github.com/Ravenium22/Keyvane/blob/main/docs/python.md). MIT licensed.
