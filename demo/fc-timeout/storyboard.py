"""Load and validate storyboard.toml, the explainer's timing and narration source.

Segments are laid end to end, so their absolute start times and the total duration
are derived rather than written by hand. Narration cues are resolved to absolute
times, placeholders are filled, and each cue is checked for overlap and for a
speaking rate that a text-to-speech pass can fit inside the cue window.
"""

import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Segment:
    """One scene segment.

    Attributes:
        id: Scene renderer identifier.
        start: Absolute start time in seconds.
        duration: Length in seconds.
        beats: Named animation times relative to the segment start.
    """

    id: str
    start: float
    duration: float
    beats: dict[str, float]


@dataclass(frozen=True)
class Cue:
    """One narration cue with absolute timing.

    Attributes:
        ident: WebVTT cue identifier, such as "setup-2".
        start: Absolute start time in seconds.
        end: Absolute end time in seconds.
        text: Narration text with placeholders filled.
    """

    ident: str
    start: float
    end: float
    text: str


class Storyboard:
    """Validated storyboard contents."""

    def __init__(self, data: dict[str, Any]) -> None:
        """Build segments from parsed TOML and validate their beats.

        Args:
            data: Parsed storyboard.toml contents.

        Raises:
            ValueError: If a segment has a nonpositive duration or a beat outside the segment.
        """
        self.config = data
        video = data["video"]
        self.width: int = video["width"]
        self.height: int = video["height"]
        self.fps: int = video["fps"]
        self.max_words_per_second: float = video["max_words_per_second"]
        self.segments: list[Segment] = []
        start = 0.0
        for raw in data["segments"]:
            segment = Segment(raw["id"], start, float(raw["duration"]), {k: float(v) for k, v in raw.get("beats", {}).items()})
            if segment.duration <= 0:
                raise ValueError(f"segment {segment.id}: duration must be positive")
            for name, beat in segment.beats.items():
                if not 0 <= beat <= segment.duration:
                    raise ValueError(f"segment {segment.id}: beat {name}={beat} is outside 0..{segment.duration}")
            self.segments.append(segment)
            start += segment.duration
        self.duration = start

    @classmethod
    def load(cls, path: Path) -> Storyboard:
        """Read a storyboard file.

        Args:
            path: Path to storyboard.toml.

        Returns:
            The validated storyboard.
        """
        with path.open("rb") as handle:
            return cls(tomllib.load(handle))

    def cues(self, values: dict[str, str]) -> list[Cue]:
        """Resolve narration cues to absolute times and validate them.

        Args:
            values: Placeholder values substituted into cue text.

        Returns:
            Cues in playback order.

        Raises:
            ValueError: If a cue lies outside its segment, overlaps the previous cue, or is too fast to speak.
        """
        cues: list[Cue] = []
        for segment, raw in zip(self.segments, self.config["segments"], strict=True):
            for index, item in enumerate(raw.get("cues", []), start=1):
                ident = f"{segment.id}-{index}"
                if not 0 <= item["at"] < item["end"] <= segment.duration:
                    raise ValueError(f"cue {ident}: times must satisfy 0 <= at < end <= {segment.duration}")
                cue = Cue(ident, segment.start + item["at"], segment.start + item["end"], item["text"].format_map(values))
                if cues and cue.start < cues[-1].end:
                    raise ValueError(f"cue {ident} overlaps cue {cues[-1].ident}")
                rate = len(cue.text.split()) / (cue.end - cue.start)
                if rate > self.max_words_per_second:
                    raise ValueError(f"cue {ident}: {rate:.2f} words/s exceeds {self.max_words_per_second}; shorten the text or widen the cue")
                cues.append(cue)
        return cues
