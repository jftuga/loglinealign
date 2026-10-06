"""Shared record type and timestamp formatting for the generated logs.

Each log generator produces LogRecord values carrying the true UTC instant and the
fully formatted text, which may span several physical lines. Timestamps are written
as local wall-clock time without an offset, which is the condition that makes the
logs impossible to correlate until per-file time zones are applied.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol


@dataclass(frozen=True)
class LogRecord:
    """One log entry.

    Attributes:
        time: True UTC instant of the entry, used only for ordering within a file.
        text: Formatted entry text; continuation lines are separated by newlines.
    """

    time: datetime
    text: str


class LogSource(Protocol):
    """Anything that can produce the records of one log file."""

    def records(self) -> list[LogRecord]:
        """Return every record of the log, in any order.

        Returns:
            The log's records.
        """
        ...


def format_local(utc: datetime, offset: timedelta, separator: str, fraction_digits: int) -> str:
    """Format a UTC instant as local wall-clock time without an offset.

    Args:
        utc: Instant to format.
        offset: Local UTC offset.
        separator: Text between date and time, such as " " or "T".
        fraction_digits: Number of fractional-second digits to keep (truncated).

    Returns:
        A timestamp such as "2026-09-15 13:37:12.418".
    """
    local = (utc + offset).replace(tzinfo=None)
    fraction = f"{local.microsecond:06d}"[:fraction_digits]
    return f"{local:%Y-%m-%d}{separator}{local:%H:%M:%S}.{fraction}"


def render_log(records: list[LogRecord]) -> str:
    """Render records into file content ordered by time.

    Args:
        records: Records to render; equal times keep their input order.

    Returns:
        Newline-terminated file content.
    """
    ordered = sorted(records, key=lambda record: record.time)
    return "".join(f"{record.text}\n" for record in ordered)
