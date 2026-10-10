"""Run both loglinealign merges and write the scene data and narration script.

This is the bridge between the generated logs and the rendered video: it executes
the real CLI, extracts the lines the scene shows, and writes build/scene-data.js
(loaded by scene/index.html) and build/narration-base.vtt (the original voice script).
"""

import argparse
import json
from pathlib import Path

from merge_runner import run_merge, timezone_options
from scene_data import SceneDataBuilder
from storyboard import Storyboard
from vtt import render_vtt


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    Returns:
        Parsed arguments.
    """
    parser = argparse.ArgumentParser(description="Build scene data and narration from the scenario logs.")
    parser.add_argument("--loglinealign", type=Path, default=Path("../../dist/loglinealign.js"), help="path to the built CLI")
    parser.add_argument("--logs", type=Path, default=Path("sample-logs"), help="directory with the generated logs")
    parser.add_argument("--storyboard", type=Path, default=Path("storyboard.toml"), help="storyboard file")
    parser.add_argument("--build", type=Path, default=Path("build"), help="output directory")
    return parser.parse_args()


def main() -> None:
    """Run the merges and write the scene data and VTT files."""
    args = parse_args()
    args.build.mkdir(exist_ok=True)
    storyboard = Storyboard.load(args.storyboard)
    scenario = json.loads((args.logs / "scenario.json").read_text(encoding="utf-8"))
    files = [source["file"] for source in scenario["sources"]]
    naive = run_merge(args.loglinealign, args.logs, files, [], args.build / "merged-naive.log")
    zones = timezone_options([(source["file"], source["offset"]) for source in scenario["sources"]])
    aligned = run_merge(args.loglinealign, args.logs, files, zones, args.build / "merged-aligned.log")
    builder = SceneDataBuilder(storyboard, scenario, args.logs, naive, aligned)
    cues = storyboard.cues(builder.placeholders())
    data = builder.build(cues)
    (args.build / "scene-data.js").write_text(f"window.SCENE_DATA = {json.dumps(data, separators=(',', ':'))};\n", encoding="utf-8")
    (args.build / "narration-base.vtt").write_text(render_vtt(cues), encoding="utf-8")
    print(f"wrote {args.build / 'scene-data.js'}, {args.build / 'narration-base.vtt'} ({len(cues)} cues, {storyboard.duration:.1f} s)")
    print(f"aligned command: {aligned.command}")


if __name__ == "__main__":
    main()
