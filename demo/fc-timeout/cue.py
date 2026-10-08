"""The narration cue record shared by the storyboard, the WebVTT writer and reader, and the narrator.

It lives in its own module so the narration script, which runs on Python 3.12 because
Kokoro does not support 3.14 yet, can import it without loading storyboard.py. Keep this
file and vtt.py free of syntax newer than 3.12.
"""

from dataclasses import dataclass


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
