"""Assemble the data the HTML scene renders, from the generated logs and real merges.

Every log line that appears in the video is taken verbatim (or, for the per-team
panes, condensed to time and message) from the generated logs or from loglinealign
output. Timing comes from the storyboard; incident ground truth comes from the
scenario JSON. The result is one JSON-serializable dictionary.
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from cue import Cue
from log_blocks import Block, read_merged_blocks, read_raw_blocks, require_utc_order
from merge_runner import MergeResult
from storyboard import Storyboard

MUNICH_KEYS = ("db", "os")


def parse_offset(text: str) -> timedelta:
    """Parse a "±HH:MM" offset.

    Args:
        text: Offset text.

    Returns:
        The offset as a timedelta.
    """
    sign = -1 if text.startswith("-") else 1
    hours, minutes = text[1:].split(":")
    return sign * timedelta(hours=int(hours), minutes=int(minutes))


def parse_utc(text: str) -> datetime:
    """Parse an ISO 8601 UTC instant into a naive UTC datetime.

    Args:
        text: Instant such as "2026-09-15T08:07:12.418306Z".

    Returns:
        The naive UTC datetime.
    """
    return datetime.fromisoformat(text).replace(tzinfo=None)


def severity(text: str, patterns: dict[str, list[str]]) -> int:
    """Classify a log line as info (0), warning (1), or error (2).

    Args:
        text: Log line.
        patterns: Substring lists keyed "error" and "warn".

    Returns:
        The severity level.
    """
    if any(p in text for p in patterns.get("error", [])):
        return 2
    if any(p in text for p in patterns.get("warn", [])):
        return 1
    return 0


def pick_rows(blocks: list[Block], start: datetime, end: datetime, patterns: list[str]) -> list[tuple[Block, str, int]]:
    """Select the first block per pattern inside a UTC window, with match counts.

    Args:
        blocks: Candidate blocks in display order.
        start: Inclusive UTC window start.
        end: Inclusive UTC window end.
        patterns: Substrings to look for, each yielding at most one row.

    Returns:
        (block, pattern, count) tuples in display order; a block is never selected twice.
    """
    window = [b for b in blocks if start <= b.utc <= end]
    chosen: dict[int, tuple[str, int]] = {}
    for pattern in patterns:
        matches = [i for i, b in enumerate(window) if pattern in b.text and i not in chosen]
        if matches:
            chosen[matches[0]] = (pattern, len(matches))
    return [(window[i], *chosen[i]) for i in sorted(chosen)]


def condense(key: str, text: str) -> tuple[str, str]:
    """Split a raw log line into its clock time and a compact message for a narrow pane.

    Args:
        key: Source key, selecting the line layout.
        text: Raw log line.

    Returns:
        (time of day as written, condensed message).
    """
    clock, rest = text[11:].split(" ", 1)
    if key == "app":
        level = rest.split()[0]
        rest = f"{level} {rest.split(' : ', 1)[1]}"
    elif key == "db":
        rest = rest.split(None, 1)[1]
    else:
        rest = rest.split(" ", 1)[1]
    return clock, rest


class SceneDataBuilder:
    """Builds the scene data dictionary."""

    def __init__(self, storyboard: Storyboard, scenario: dict[str, Any], log_dir: Path, naive: MergeResult, aligned: MergeResult) -> None:
        """Load all blocks and verify the aligned merge order.

        Args:
            storyboard: Validated storyboard.
            scenario: Parsed scenario.json.
            log_dir: Directory containing the generated logs.
            naive: Merge run without time zone options.
            aligned: Merge run with per-file time zones.
        """
        self._storyboard = storyboard
        self._config = storyboard.config
        self._sources = scenario["sources"]
        self._naive = naive
        self._aligned = aligned
        self._window_start = parse_utc(scenario["window_utc"][0])
        self._incidents = {i["number"]: parse_utc(i["loop_down_utc"]) for i in scenario["incidents"]}
        offsets = {s["key"]: parse_offset(s["offset"]) for s in self._sources}
        self._offsets = offsets
        self._raw = {s["key"]: read_raw_blocks(log_dir / s["file"], s["key"], offsets[s["key"]]) for s in self._sources}
        labels = {s["file"]: (s["key"], offsets[s["key"]]) for s in self._sources}
        self._naive_blocks = read_merged_blocks(naive.output, labels)
        self._aligned_blocks = read_merged_blocks(aligned.output, labels)
        require_utc_order(self._aligned_blocks)

    def placeholders(self) -> dict[str, str]:
        """Compute narration placeholder values from the logs.

        Returns:
            Values for {app_alert_hhmm} and {munich_hhmm}.

        Raises:
            ValueError: If the first incident lacks an SLO breach or link-down entry.
        """
        start, end = self._window(self._config["escalation"])
        alert = pick_rows(self._raw["app"], start, end, ["SLO breach"])
        down = pick_rows(self._raw["os"], start, end, ["LOOP DOWN"])
        if not alert or not down:
            raise ValueError("first incident needs an SLO breach and a LOOP DOWN entry")
        return {"app_alert_hhmm": f"{alert[0][0].wall:%H:%M}", "munich_hhmm": f"{down[0][0].wall:%H:%M}"}

    def build(self, cues: list[Cue]) -> dict[str, Any]:
        """Assemble the complete scene data.

        Args:
            cues: Resolved narration cues.

        Returns:
            JSON-serializable scene data.
        """
        storyboard = self._storyboard
        return {
            "video": {"width": storyboard.width, "height": storyboard.height, "fps": storyboard.fps, "duration": storyboard.duration},
            "segments": [{"id": s.id, "start": s.start, "duration": s.duration, "beats": s.beats} for s in storyboard.segments],
            "cues": [{"ident": c.ident, "start": c.start, "end": c.end, "text": c.text} for c in cues],
            "sources": [{**s, "offset_seconds": self._offsets[s["key"]].total_seconds()} for s in self._sources],
            "incidents": [{"number": n, "utc_seconds": self._day_seconds(t)} for n, t in self._incidents.items()],
            "first_incident_utc_seconds": self._day_seconds(self._incidents[self._config["escalation"]["incident"]]),
            "placeholders": self.placeholders(),
            "lanes": self._lanes(),
            "escalation": self._escalation(),
            "merge": self._merge(),
            "closeup": self._closeup(),
            "pattern": self._pattern(),
        }

    def _day_seconds(self, moment: datetime) -> float:
        """Convert a naive datetime to seconds after midnight of the window's date.

        Args:
            moment: Naive datetime (local or UTC).

        Returns:
            Seconds after midnight, rounded to microseconds.
        """
        midnight = self._window_start.replace(hour=0, minute=0, second=0, microsecond=0)
        return round((moment - midnight).total_seconds(), 6)

    def _window(self, section: dict[str, Any], incident: int | None = None) -> tuple[datetime, datetime]:
        """Compute a UTC window around an incident's link drop.

        Args:
            section: Configuration section with "incident" and "window" keys.
            incident: Incident number overriding the section's.

        Returns:
            (start, end) naive UTC datetimes.
        """
        anchor = self._incidents[incident or section["incident"]]
        before, after = section["window"]
        return anchor + timedelta(seconds=before), anchor + timedelta(seconds=after)

    def _lanes(self) -> dict[str, list[list[float]]]:
        """Build per-source timeline ticks.

        Returns:
            For each source key, [written wall-clock seconds after midnight, severity] pairs.
        """
        patterns = self._config["severity"]
        return {key: [[self._day_seconds(b.wall), severity(b.text, patterns[key])] for b in blocks] for key, blocks in self._raw.items()}

    def _escalation(self) -> dict[str, Any]:
        """Build each team's isolated view of the first incident.

        Returns:
            Condensed rows per source, plus the database team's search for the app's alert time.
        """
        section = self._config["escalation"]
        start, end = self._window(section)
        panes: dict[str, Any] = {}
        for key, blocks in self._raw.items():
            rows = []
            for block, _, count in pick_rows(blocks, start, end, section[key]):
                clock, message = condense(key, block.text)
                rows.append({"clock": clock, "message": message, "count": count, "severity": severity(block.text, self._config["severity"][key])})
            panes[key] = {"date": f"{blocks[0].wall:%Y-%m-%d}", "rows": rows}
        query = self.placeholders()["app_alert_hhmm"]
        panes["db"]["search"] = {"query": query, "matches": sum(1 for b in self._raw["db"] if query in b.text)}
        return panes

    def _merge(self) -> dict[str, Any]:
        """Describe both merge runs, including the naive merge's Munich-to-Mumbai seam.

        Returns:
            Commands, the naive warning, and verbatim lines around the seam.
        """
        blocks = self._naive_blocks
        seam = next(i for i in range(1, len(blocks)) if blocks[i - 1].key in MUNICH_KEYS and blocks[i].key == "app")
        return {
            "naive": {"command": self._naive.command, "warning": self._naive.stderr, "seam": [b.line for b in blocks[seam - 2 : seam + 2]], "seam_index": 2},
            "aligned": {"command": self._aligned.command},
        }

    def _closeup(self) -> dict[str, Any]:
        """Build the aligned, verbatim close-up of the first incident.

        Returns:
            Group descriptions and rows in merged order with seconds relative to the link drop.
        """
        section = self._config["closeup"]
        start, end = self._window(section)
        anchor = self._incidents[section["incident"]]
        rows = []
        for group in section["groups"]:
            for block, _, count in pick_rows(self._aligned_blocks, start, end, group["patterns"]):
                rows.append((block.utc, {"group": group["id"], "key": block.key, "line": block.line, "rel": (block.utc - anchor).total_seconds(), "count": count}))
        rows.sort(key=lambda item: item[0])
        groups = [{"id": g["id"], "label": g["label"], "note": g["note"]} for g in section["groups"]]
        return {"incident": section["incident"], "groups": groups, "rows": [row for _, row in rows]}

    def _pattern(self) -> list[dict[str, Any]]:
        """Measure each causal step of every incident from the aligned merge.

        Returns:
            One row per incident with seconds from link drop to each group's first entry and the failing HBA port.
        """
        section = self._config["closeup"]
        rows = []
        for number, anchor in self._incidents.items():
            start, end = self._window(section, number)
            window = [b for b in self._aligned_blocks if start <= b.utc <= end]
            steps: dict[str, float | None] = {}
            port = ""
            for group in section["groups"]:
                first = next((b for b in window if any(p in b.text for p in group["patterns"])), None)
                steps[group["id"]] = None if first is None else round((first.utc - anchor).total_seconds(), 3)
                if first is not None and "qla2xxx [" in first.text and not port:
                    pci = first.text.split("qla2xxx [", 1)[1].split("]", 1)[0]
                    host = first.text.split("]-", 1)[1].split(":")[1]
                    port = f"host{host} · {pci}"
            rows.append({"number": number, "utc_seconds": self._day_seconds(anchor), "steps": steps, "port": port})
        return rows
