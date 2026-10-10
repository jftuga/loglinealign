"""Build relative browser subtitles and the combined full-length narration script.

Original cues retain their timestamps and text. Browser cues are shifted by the
original storyboard duration, so subtitles and the appended audio share one clock.
"""

import argparse
from dataclasses import replace
from pathlib import Path

from storyboard import Storyboard
from vtt import parse_vtt, render_vtt


def main() -> None:
    """Parse paths and write the browser and complete WebVTT scripts."""
    parser = argparse.ArgumentParser(description="Append the browser narration cues.")
    parser.add_argument("--base", type=Path, default=Path("build/narration-base.vtt"))
    parser.add_argument("--storyboard", type=Path, default=Path("storyboard.toml"))
    parser.add_argument("--browser-storyboard", type=Path, default=Path("browser-storyboard.toml"))
    parser.add_argument("--build", type=Path, default=Path("build"))
    args = parser.parse_args()
    base = Storyboard.load(args.storyboard)
    browser = Storyboard.load(args.browser_storyboard)
    original = parse_vtt(args.base.read_text())
    if original and original[-1].end > base.duration:
        raise ValueError("original narration exceeds the original storyboard")
    added = browser.cues({})
    shifted = [replace(cue, start=cue.start + base.duration, end=cue.end + base.duration) for cue in added]
    args.build.mkdir(parents=True, exist_ok=True)
    (args.build / "browser.vtt").write_text(render_vtt(added))
    (args.build / "narration.vtt").write_text(render_vtt(original + shifted))
    print(f"wrote {len(original) + len(added)} cues for {base.duration + browser.duration:.1f}s")


if __name__ == "__main__":
    main()
