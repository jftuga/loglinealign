"""Speak narration cues with Kokoro-82M and fit each one inside its cue window.

Each cue is spoken at normal speed with the silence at its edges trimmed. A cue that
runs past its window is spoken again slightly faster, up to a cap. One that still does
not fit is reported as an overrun rather than time-stretched, so the fix is to widen
the cue in storyboard.toml.
"""

from dataclasses import dataclass

import numpy as np
from kokoro import KPipeline

from cue import Cue
from spoken_text import spoken

SAMPLE_RATE = 24_000
SILENCE_THRESHOLD = 1e-3
SPEED_HEADROOM = 1.02


@dataclass(frozen=True)
class Clip:
    """Speech for one cue.

    Attributes:
        cue: The cue spoken.
        audio: Mono float32 samples at SAMPLE_RATE.
        speed: Kokoro speed the audio was generated at.
        window: Seconds available for speech.
    """

    cue: Cue
    audio: np.ndarray
    speed: float
    window: float

    @property
    def seconds(self) -> float:
        """Length of the speech in seconds."""
        return self.audio.size / SAMPLE_RATE

    @property
    def overrun(self) -> float:
        """Seconds by which the speech exceeds its window, or 0 if it fits."""
        return max(self.seconds - self.window, 0.0)


class Narrator:
    """A Kokoro voice that speaks cues within their windows."""

    def __init__(self, voice: str, max_speed: float, margin: float) -> None:
        """Load the Kokoro model for a voice.

        Args:
            voice: Kokoro voice name; its first letter is the language code, such as "a" for US English in "af_heart".
            max_speed: Highest speed used to fit a cue, where 1.0 is normal.
            margin: Seconds left free at the end of each cue window.

        Raises:
            ValueError: If max_speed is below 1.0 or margin is negative.
        """
        if max_speed < 1.0:
            raise ValueError(f"max_speed must be at least 1.0, got {max_speed}")
        if margin < 0:
            raise ValueError(f"margin must be nonnegative, got {margin}")
        self.voice = voice
        self.max_speed = max_speed
        self.margin = margin
        self.pipeline = KPipeline(lang_code=voice[0], repo_id="hexgrad/Kokoro-82M")

    def synthesize(self, text: str, speed: float) -> np.ndarray:
        """Speak text and trim leading and trailing silence.

        Args:
            text: Text to speak, already rewritten for speech.
            speed: Speaking-rate multiplier.

        Returns:
            Mono float32 samples at SAMPLE_RATE.

        Raises:
            RuntimeError: If Kokoro produces no audible output.
        """
        chunks = [result.audio.numpy() for result in self.pipeline(text, voice=self.voice, speed=speed) if result.audio is not None]
        audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
        voiced = np.flatnonzero(np.abs(audio) > SILENCE_THRESHOLD)
        if voiced.size == 0:
            raise RuntimeError(f"no speech generated for {text!r}")
        return audio[voiced[0] : voiced[-1] + 1]

    def fit(self, cue: Cue) -> Clip:
        """Speak a cue at normal speed, then faster until it fits its window or reaches max_speed.

        Kokoro's speed does not shorten speech in exact proportion, so the speed is
        raised by the remaining overrun ratio on each attempt rather than set once.

        Args:
            cue: The cue to speak.

        Returns:
            The clip; check Clip.overrun to see whether it fits.
        """
        text = spoken(cue.text)
        window = cue.end - cue.start - self.margin
        clip = Clip(cue, self.synthesize(text, 1.0), 1.0, window)
        while clip.overrun and clip.speed < self.max_speed:
            speed = min(clip.speed * clip.seconds / window * SPEED_HEADROOM, self.max_speed)
            clip = Clip(cue, self.synthesize(text, speed), speed, window)
        return clip
