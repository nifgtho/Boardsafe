"""Normalize offset-aware input to the database's naive UTC convention."""
from datetime import datetime, timezone


def to_utc_naive(value: datetime) -> datetime:
    # Legacy timestamps without an offset are explicitly interpreted as UTC.
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def utc_iso(value: datetime) -> str:
    return to_utc_naive(value).isoformat() + "Z"
