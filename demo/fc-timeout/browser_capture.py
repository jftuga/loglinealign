"""Capture actual browser frames on a fixed video clock with Playwright.

Mouse movements and scrolling are sampled at the output frame rate. Static holds
reuse a screenshot, so machine speed never changes the narration's timing.
"""

import subprocess
from pathlib import Path

from playwright.sync_api import Page


class BrowserCapture:
    """Encode browser screenshots and make the pointer visible in the video."""

    def __init__(self, page: Page, out: Path, fps: int) -> None:
        """Start the encoder and install a presentation-only pointer overlay.

        Args:
            page: The real application page to capture.
            out: Destination MP4.
            fps: Output frames per second.
        """
        if fps <= 0:
            raise ValueError("fps must be positive")
        self.page = page
        self.fps = fps
        self.frame = 0
        self.pointer = (1350.0, 90.0)
        out.parent.mkdir(parents=True, exist_ok=True)
        self.encoder = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)], stdin=subprocess.PIPE)
        page.evaluate("""() => {
            const pointer = document.createElement('div');
            pointer.id = 'demo-pointer';
            pointer.style.cssText = 'position:fixed;left:1350px;top:90px;width:24px;height:24px;border:2px solid white;border-radius:50%;background:#9de1bb55;box-shadow:0 0 0 5px #9de1bb22;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)';
            document.body.append(pointer);
        }""")

    def capture(self, count: int = 1) -> None:
        """Write a screenshot for a given number of video frames.

        Args:
            count: Number of copies of this frame.
        """
        if count <= 0:
            return
        picture = self.page.screenshot(type="png")
        if self.encoder.stdin is None:
            raise RuntimeError("ffmpeg input is closed")
        for _ in range(count):
            self.encoder.stdin.write(picture)
        self.frame += count

    def until(self, seconds: float) -> None:
        """Hold the current view until a storyboard time, rejecting overruns.

        Args:
            seconds: Absolute time within the appended segment.
        """
        target = round(seconds * self.fps)
        if target < self.frame:
            raise ValueError(f"browser action overran {seconds}s: at {self.frame / self.fps:.2f}s")
        self.capture(target - self.frame)
        print(f"browser {seconds:.1f}s", flush=True)

    def move(self, selector: str, seconds: float = 0.5) -> None:
        """Move the visible pointer smoothly to an on-screen element.

        Args:
            selector: CSS selector of the target.
            seconds: Movement duration.
        """
        box = self.page.locator(selector).bounding_box()
        if box is None:
            raise RuntimeError(f"cannot point to hidden element {selector}")
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        width, height = self.page.evaluate("[innerWidth, innerHeight]")
        if not (0 <= x <= width and 0 <= y <= height):
            raise RuntimeError(f"scroll {selector} into view before moving the pointer")
        start_x, start_y = self.pointer
        frames = max(1, round(seconds * self.fps))
        for index in range(1, frames + 1):
            t = index / frames
            t = t * t * (3 - 2 * t)
            position = (start_x + (x - start_x) * t, start_y + (y - start_y) * t)
            self.page.mouse.move(*position)
            self.page.evaluate("([x,y]) => Object.assign(document.getElementById('demo-pointer').style, {left:x+'px',top:y+'px'})", position)
            self.capture()
        self.pointer = (x, y)

    def click(self, selector: str) -> None:
        """Point to a control and perform an actual browser click.

        Args:
            selector: CSS selector of the control.
        """
        self.move(selector)
        self.page.locator(selector).click()
        self.page.evaluate("document.getElementById('demo-pointer').style.background = '#ffffffbb'")
        self.capture(round(self.fps * 0.2))
        self.page.evaluate("document.getElementById('demo-pointer').style.background = '#9de1bb55'")

    def type_text(self, selector: str, text: str) -> None:
        """Type through browser input events, capturing each character.

        Args:
            selector: Input element selector.
            text: Text to enter into an initially empty input.
        """
        self.click(selector)
        for character in text:
            self.page.locator(selector).press_sequentially(character)
            self.capture(3)

    def scroll(self, top: float, selector: str | None = None, seconds: float = 1.0) -> None:
        """Animate real document or log viewport scrolling.

        Args:
            top: Target vertical scroll offset in CSS pixels.
            selector: Scroll container, or None for the document.
            seconds: Movement duration.
        """
        start = self.page.evaluate("s => s ? document.querySelector(s).scrollTop : scrollY", selector)
        frames = max(1, round(seconds * self.fps))
        for index in range(1, frames + 1):
            t = index / frames
            t = t * t * (3 - 2 * t)
            self.page.evaluate("([s,y]) => (s ? document.querySelector(s) : window).scrollTo(0,y)", [selector, start + (top - start) * t])
            # Let the application's virtualized rows catch up with the scroll event.
            self.page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            if selector == "#viewport":
                self.page.wait_for_function("Math.abs(parseFloat(document.getElementById('rows').style.top || '0') - document.getElementById('viewport').scrollTop) < 1")
            self.capture()

    def still(self, path: Path) -> None:
        """Save a full-resolution review image without advancing video time.

        Args:
            path: Destination PNG.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(path))

    def finish(self) -> None:
        """Close the encoder and fail if encoding did not complete successfully."""
        if self.encoder.stdin is not None:
            self.encoder.stdin.close()
        if self.encoder.wait() != 0:
            raise RuntimeError(f"ffmpeg exited with {self.encoder.returncode}")

    def abort(self) -> None:
        """Stop the encoder when a browser action fails."""
        self.encoder.terminate()
        self.encoder.communicate()
