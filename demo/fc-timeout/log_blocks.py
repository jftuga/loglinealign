"""Read log entries back from the generated logs and from loglinealign output.

All three scenario logs begin each entry with a local "YYYY-MM-DD?HH:MM:SS.fraction"
timestamp and no offset, so one parser serves them all. Merged output lines carry a
right-justified "[label] " prefix, which identifies the source and its offset. The
merged reader also verifies that loglinealign produced true chronological order.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import pairwise
from pathlib import Path


@dataclass(frozen=True)
class Block:
    """The first physical line of one log entry, with its times.

    Attributes:
        key: Source key (app, db, os).
        wall: Local wall-clock time exactly as written.
        utc: True UTC time (naive), derived from the source's offset.
        line: The line as it appears in its file, including any merge label.
        text: The line without a merge label.
    """

    key: str
    wall: datetime
    utc: datetime
    line: str
    text: str


def parse_wall(text: str) -> datetime | None:
    """Parse the leading local timestamp of a log line.

    Args:
        text: Log line without a merge label.

    Returns:
        The naive local timestamp, or None for continuation lines.
    """
    if len(text) < 20 or not text[:4].isdigit() or text[4] != "-":
        return None
    whole = datetime.fromisoformat(f"{text[:10]}T{text[11:19]}")
    fraction = text[20:].split(" ", 1)[0]
    return whole + timedelta(microseconds=int(fraction.ljust(6, "0")[:6]))


def read_raw_blocks(path: Path, key: str, offset: timedelta) -> list[Block]:
    """Read entry-starting lines from one generated log.

    Args:
        path: Log file.
        key: Source key.
        offset: Source UTC offset.

    Returns:
        Blocks in file order.
    """
    blocks: list[Block] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        wall = parse_wall(line)
        if wall is not None:
            blocks.append(Block(key, wall, wall - offset, line, line))
    return blocks


def read_merged_blocks(path: Path, sources: dict[str, tuple[str, timedelta]]) -> list[Block]:
    """Read entry-starting lines from loglinealign output.

    Args:
        path: Merged log produced with filename labels.
        sources: Map of label (filename) to (source key, UTC offset).

    Returns:
        Blocks in merged order.

    Raises:
        ValueError: If a line has no recognizable label.
    """
    blocks: list[Block] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("[") or "] " not in line:
            raise ValueError(f"unlabeled merged line: {line[:80]}")
        label, text = line[1:].split("] ", 1)
        wall = parse_wall(text)
        if wall is not None:
            key, offset = sources[label.strip()]
            blocks.append(Block(key, wall, wall - offset, line, text))
    return blocks


def require_utc_order(blocks: list[Block]) -> None:
    """Verify that merged blocks are in nondecreasing UTC order.

    Args:
        blocks: Blocks in merged order.

    Raises:
        RuntimeError: If any block is earlier than its predecessor.
    """
    for previous, current in pairwise(blocks):
        if current.utc < previous.utc:
            raise RuntimeError(f"merged output is not in UTC order near: {current.line[:100]}")
