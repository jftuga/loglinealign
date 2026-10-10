"""Drive the real offline log merger through the narrated demonstration.

The walkthrough loads the scenario files and uses ordinary UI controls. It also
checks source colors, ordering, and the downloaded text before accepting a capture.
"""

import json
from pathlib import Path

from playwright.sync_api import Page

from browser_capture import BrowserCapture
from storyboard import Storyboard


class BrowserWalkthrough:
    """Perform the browser actions at the storyboard's named beats."""

    def __init__(self, capture: BrowserCapture, storyboard: Storyboard, logs: Path, build: Path) -> None:
        """Load the scenario and store the recording configuration.

        Args:
            capture: Recorder for the actual browser page.
            storyboard: Browser timing and narration.
            logs: Scenario log directory.
            build: Generated artifact directory.
        """
        self.capture = capture
        self.page = capture.page
        self.storyboard = storyboard
        self.beats = storyboard.segments[0].beats
        self.logs = logs
        self.build = build
        self.sources = json.loads((logs / "scenario.json").read_text())["sources"]

    def beat(self, name: str) -> None:
        """Hold until an action's named time.

        Args:
            name: Beat in browser-storyboard.toml.
        """
        self.capture.until(self.beats[name])

    def ready(self) -> None:
        """Wait for the worker to finish merging and rendering its first rows."""
        self.page.wait_for_function("!document.getElementById('download').disabled && document.querySelectorAll('.log-row').length > 0")
        if self.page.locator("#errors").is_visible():
            raise RuntimeError(self.page.locator("#errors").inner_text())

    def log_view(self) -> None:
        """Scroll the document until the log viewport fills the frame."""
        top = self.page.locator("#viewport").evaluate("e => e.getBoundingClientRect().top + scrollY - 70")
        self.capture.scroll(top)

    def three_source_row(self) -> int:
        """Choose a slow-I/O window containing all three file labels.

        Returns:
            First row index of a 26-line window suitable for the capture.

        Raises:
            RuntimeError: If no such window exists in the actual aligned merge.
        """
        rows = (self.build / "merged-aligned.log").read_text().splitlines()
        for index, row in enumerate(rows):
            if "taking longer than" not in row:
                continue
            start = max(0, index - 12)
            labels = {line.split("]", 1)[0].lstrip("[ ") for line in rows[start:start + 26]}
            if labels == {source["file"] for source in self.sources}:
                return start
        raise RuntimeError("no incident window contains all three source colors")

    def run(self, endcard: Page) -> None:
        """Capture the walkthrough and its final two-second closing-card hold.

        Args:
            endcard: Original explainer scene, positioned on its closing card.
        """
        c = self.capture
        self.beat("privacy")
        c.move(".offline")
        self.beat("load")
        c.move(".picker")
        self.page.locator("#file-picker").set_input_files([self.logs / source["file"] for source in self.sources])
        self.ready()
        c.capture(15)
        c.scroll(self.page.locator("#files").evaluate("e => e.getBoundingClientRect().top + scrollY - 50"))
        self.beat("zones")
        for index, source in enumerate(self.sources):
            c.type_text(f"#timezone-{index}", source["offset"])
            c.capture(30)
        c.still(self.build / "browser-stills/01-timezones.png")
        c.scroll(0)
        c.click("#remerge-sources")
        self.ready()
        self.beat("merge")
        c.click("#collapse-controls")
        self.log_view()
        c.scroll(self.three_source_row() * 22, "#viewport", seconds=2.0)
        self.beat("colors")
        visible = self.page.locator(".log-row").evaluate_all("rows => rows.filter(e => { const r=e.getBoundingClientRect(); return r.top>=70 && r.bottom<=innerHeight; }).map(e => ({order:e.dataset.order,color:getComputedStyle(e).color,text:e.textContent}))")
        if {row["order"] for row in visible} != {"0", "1", "2"} or len({row["color"] for row in visible}) != 3:
            raise RuntimeError("the captured window does not visibly contain all three source colors")
        (self.build / "browser-visible-sources.json").write_text(json.dumps(visible, indent=2) + "\n")
        c.still(self.build / "browser-stills/02-three-colors.png")
        self.beat("settings")
        c.scroll(0)
        c.click("#settings-tab")
        c.click("#collapse-controls")
        c.click("#reverse")
        self.ready()
        c.click("#no-filename")
        self.page.wait_for_function("!document.querySelector('.log-row').textContent.startsWith('[')")
        c.still(self.build / "browser-stills/03-settings.png")
        self.beat("newest")
        self.log_view()
        c.scroll(0, "#viewport", seconds=0.3)
        if "newest first" not in self.page.locator("#status").inner_text():
            raise RuntimeError("reverse order was not applied")
        c.still(self.build / "browser-stills/04-newest.png")
        self.beat("search")
        c.scroll(0)
        c.click("#filter-tab")
        for selector in ("#filter-case", "#filter-word", "#filter-regex"):
            c.move(selector)
            c.capture(45)
        c.still(self.build / "browser-stills/05-search-options.png")
        self.beat("query")
        c.type_text("#filter-text", "LOOP")
        self.page.wait_for_function("document.getElementById('download').textContent.includes('filtered') && document.querySelectorAll('.log-row mark').length > 0")
        self.ready()
        self.beat("filtered")
        c.click("#collapse-controls")
        self.log_view()
        c.still(self.build / "browser-stills/06-filtered.png")
        self.beat("download")
        c.scroll(0)
        c.click("#download-tab")
        c.click("#collapse-controls")
        c.type_text("#download-name", "fc-link-filtered.log")
        with self.page.expect_download() as received:
            c.click("#download")
        download = received.value
        destination = self.build / download.suggested_filename
        download.save_as(destination)
        expected = [line for line in (self.logs / "os-munich.log").read_text().splitlines() if "loop" in line.lower()][::-1]
        if not expected or destination.read_text().splitlines() != expected:
            raise RuntimeError("download differs from the expected newest-first, filename-free filtered logs")
        c.still(self.build / "browser-stills/07-download.png")
        print(f"verified download: {destination} ({len(expected)} matching lines)", flush=True)
        self.beat("fade")
        frames = round((self.beats["card"] - self.beats["fade"]) * c.fps)
        for frame in range(1, frames + 1):
            self.page.evaluate("opacity => document.body.style.opacity = opacity", 1 - frame / frames)
            c.capture()
        c.page = endcard
        # Fade in for 0.6 seconds, then hold the fully visible original card for two seconds.
        for frame in range(1, 19):
            endcard.evaluate("opacity => document.body.style.opacity = opacity", frame / 18)
            c.capture()
        c.still(self.build / "browser-stills/08-endcard.png")
        c.until(self.storyboard.duration)
