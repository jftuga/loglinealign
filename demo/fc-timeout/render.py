"""Render the explainer scene to MP4 or to still frames with Playwright and ffmpeg.

The scene exposes window.seek(t), so frames are captured one at a time at exact
times rather than recorded in real time, which makes renders repeatable. Use
--still to inspect individual frames and --start/--end to render a short range.
"""

import argparse
import subprocess
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

from storyboard import Storyboard


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    Returns:
        Parsed arguments.
    """
    parser = argparse.ArgumentParser(description="Render the explainer scene.")
    parser.add_argument("--scene", type=Path, default=Path("scene/index.html"), help="scene HTML file")
    parser.add_argument("--storyboard", type=Path, default=Path("storyboard.toml"), help="storyboard providing size and fps")
    parser.add_argument("--out", type=Path, default=Path("build/explainer.mp4"), help="output MP4")
    parser.add_argument("--still", type=float, nargs="+", metavar="SECONDS", help="write PNG frames at these times instead of a video")
    parser.add_argument("--stills-dir", type=Path, default=Path("build/stills"), help="directory for --still frames")
    parser.add_argument("--start", type=float, default=0.0, help="first second to render")
    parser.add_argument("--end", type=float, default=None, help="last second to render (default: scene duration)")
    parser.add_argument("--captions", action="store_true", help="burn the narration cues into the frames for review")
    return parser.parse_args()


def open_scene(page: Page, scene: Path, captions: bool) -> float:
    """Load the scene and wait until it is ready to seek.

    Args:
        page: Browser page sized to the video.
        scene: Scene HTML file.
        captions: Whether to overlay narration cues.

    Returns:
        The scene duration in seconds.

    Raises:
        FileNotFoundError: If the scene file does not exist.
    """
    if not scene.is_file():
        raise FileNotFoundError(f"scene not found: {scene}")
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(scene.resolve().as_uri() + ("?captions=1" if captions else ""))
    page.wait_for_function("typeof window.seek === 'function'")
    page.evaluate("document.fonts.ready")
    if errors:
        raise RuntimeError(f"scene failed to load: {errors[0]}")
    return float(page.evaluate("window.DURATION"))


def render_stills(page: Page, times: list[float], out_dir: Path) -> None:
    """Write one PNG per requested time.

    Args:
        page: Page with the scene loaded.
        times: Times in seconds.
        out_dir: Destination directory, created if needed.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for t in times:
        page.evaluate("(t) => window.seek(t)", t)
        path = out_dir / f"frame-{t:07.2f}.png"
        path.write_bytes(page.screenshot(type="png"))
        print(f"wrote {path}")


def render_video(page: Page, fps: int, start: float, end: float, out: Path) -> None:
    """Capture frames from start to end and encode them to H.264.

    Args:
        page: Page with the scene loaded.
        fps: Frames per second.
        start: First second to render.
        end: Last second to render (exclusive).
        out: Output MP4 path.

    Raises:
        RuntimeError: If ffmpeg fails.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    first, last = round(start * fps), round(end * fps)
    command = ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(fps), "-i", "-"]
    command += ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    if encoder.stdin is None:
        raise RuntimeError("could not open a pipe to ffmpeg")
    for index, frame in enumerate(range(first, last)):
        page.evaluate("(t) => window.seek(t)", frame / fps)
        encoder.stdin.write(page.screenshot(type="png"))
        if index % (fps * 5) == 0:
            print(f"frame {frame}/{last} ({frame / fps:.1f} s)", flush=True)
    encoder.stdin.close()
    if encoder.wait() != 0:
        raise RuntimeError(f"ffmpeg exited with {encoder.returncode}")
    print(f"wrote {out} ({last - first} frames)")


def main() -> None:
    """Render stills or a video according to the arguments."""
    args = parse_args()
    storyboard = Storyboard.load(args.storyboard)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": storyboard.width, "height": storyboard.height}, device_scale_factor=1)
        duration = open_scene(page, args.scene, args.captions)
        if args.still:
            render_stills(page, args.still, args.stills_dir)
        else:
            end = duration if args.end is None else min(args.end, duration)
            if not 0 <= args.start < end:
                raise ValueError(f"invalid range: start={args.start}, end={end}")
            render_video(page, storyboard.fps, args.start, end, args.out)
        browser.close()


if __name__ == "__main__":
    main()
