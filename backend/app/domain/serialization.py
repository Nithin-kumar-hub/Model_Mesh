"""JSON serialisation helpers for domain objects.

The domain layer is pure stdlib (dataclasses + enums). This module converts any
domain object graph into JSON-safe primitives so the API edge (Pydantic/FastAPI)
and the telemetry store can emit them without importing framework types.

Rules:
- Enums serialise to their ``.value``.
- ``datetime`` serialises to an ISO-8601 string.
- dataclass instances serialise to dicts (recursively).
- lists/tuples/sets → lists; mappings → dicts.

Security: no domain object stores a raw secret, so nothing here can leak one.
Key models carry only an env-var *name* and a masked fingerprint.
"""

from __future__ import annotations

from dataclasses import fields, is_dataclass
from datetime import date, datetime
from enum import Enum
from typing import Any


def to_jsonable(obj: Any) -> Any:
    """Recursively convert ``obj`` into JSON-serialisable primitives."""
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: to_jsonable(getattr(obj, f.name)) for f in fields(obj)}
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (set, frozenset)):
        # Sets are unordered; emit a deterministic (sorted) list where possible
        # so API responses and snapshots are stable.
        items = [to_jsonable(v) for v in obj]
        try:
            return sorted(items)
        except TypeError:
            return items
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    # Last resort: stringify unknown types rather than crash the API edge.
    return str(obj)
