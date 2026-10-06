"""Write the three scenario logs and a machine-readable scenario description.

Running this script with the same scenario module always produces byte-identical
output because every generator draws from one seeded random generator in a fixed
order. The scenario JSON records sites, offsets, and incident ground truth so later
pipeline steps never duplicate those values.
"""

import argparse
import json
from datetime import datetime
from pathlib import Path
from random import Random

from app_log import AppLog
from db_log import DbLog
from log_record import LogSource, render_log
from os_log import OsLog
from scenario import APP, DB, INCIDENTS, OS, SEED, SITES, WINDOW_END, WINDOW_START, offset_text


def iso(instant: datetime) -> str:
    """Format an aware UTC instant as ISO 8601 with a Z suffix.

    Args:
        instant: Instant to format.

    Returns:
        The formatted instant with microsecond precision.
    """
    return instant.isoformat(timespec="microseconds").replace("+00:00", "Z")


def scenario_document() -> dict[str, object]:
    """Describe the scenario for downstream pipeline steps.

    Returns:
        A JSON-serializable description of sites, window, and incidents.
    """
    return {
        "seed": SEED,
        "window_utc": [iso(WINDOW_START), iso(WINDOW_END)],
        "sources": [{"key": s.key, "file": s.file, "city": s.city, "offset": offset_text(s.offset), "team": s.team, "system": s.system} for s in SITES],
        "incidents": [
            {"number": i.number, "loop_down_utc": iso(i.loop_down), "io_timeout_utc": iso(i.io_timeout), "loop_up_utc": iso(i.loop_up)}
            for i in INCIDENTS
        ],
    }


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    Returns:
        Parsed arguments.
    """
    parser = argparse.ArgumentParser(description="Generate the fibre channel timeout scenario logs.")
    parser.add_argument("--out-dir", type=Path, default=Path("sample-logs"), help="directory for the logs and scenario.json")
    return parser.parse_args()


def main() -> None:
    """Generate every log file and the scenario description."""
    args = parse_args()
    if not args.out_dir.is_dir():
        raise NotADirectoryError(f"output directory does not exist: {args.out_dir}")
    rng = Random(SEED)
    sources: list[tuple[str, LogSource]] = [
        (APP.file, AppLog(APP, INCIDENTS, rng)),
        (DB.file, DbLog(DB, INCIDENTS, rng)),
        (OS.file, OsLog(OS, INCIDENTS, rng)),
    ]
    for filename, source in sources:
        content = render_log(source.records())
        (args.out_dir / filename).write_text(content, encoding="utf-8")
        print(f"wrote {args.out_dir / filename} ({content.count(chr(10))} lines)")
    (args.out_dir / "scenario.json").write_text(json.dumps(scenario_document(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out_dir / 'scenario.json'}")


if __name__ == "__main__":
    main()
