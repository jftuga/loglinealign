"""Render the appended walkthrough using the built offline browser application.

Playwright performs real file selection, merging, filtering, and download actions.
The original scene supplies the closing card; browser-storyboard.toml supplies timing.
"""

import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_capture import BrowserCapture
from browser_walkthrough import BrowserWalkthrough
from render import open_scene
from storyboard import Storyboard


def main() -> None:
    """Parse capture options and render the browser segment."""
    parser = argparse.ArgumentParser(description="Capture the real browser walkthrough.")
    parser.add_argument("--web", type=Path, default=Path("../../dist/loglinealign.html"))
    parser.add_argument("--storyboard", type=Path, default=Path("browser-storyboard.toml"))
    parser.add_argument("--logs", type=Path, default=Path("sample-logs"))
    parser.add_argument("--build", type=Path, default=Path("build"))
    args = parser.parse_args()
    if not args.web.is_file():
        raise FileNotFoundError(f"build the web application first: {args.web}")
    storyboard = Storyboard.load(args.storyboard)
    storyboard.cues({})
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        # Playwright's wait predicates use eval, which the offline app's CSP disallows.
        # This recorder-only setting leaves the distributed HTML unchanged.
        page = browser.new_page(viewport={"width": 1440, "height": 810}, device_scale_factor=4 / 3, accept_downloads=True, bypass_csp=True)
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.web.resolve().as_uri())
        page.evaluate("document.fonts.ready")
        endcard = browser.new_page(viewport={"width": storyboard.width, "height": storyboard.height}, device_scale_factor=1)
        duration = open_scene(endcard, Path("scene/index.html"), False)
        endcard.evaluate("t => window.seek(t)", duration - 2)
        capture = BrowserCapture(page, args.build / "browser.mp4", storyboard.fps)
        try:
            BrowserWalkthrough(capture, storyboard, args.logs, args.build).run(endcard)
            if errors:
                raise RuntimeError(f"browser errors: {errors}")
            capture.finish()
        except BaseException:
            page.screenshot(path=str(args.build / "browser-error.png"))
            capture.abort()
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
