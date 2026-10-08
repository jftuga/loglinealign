# /// script
# requires-python = "==3.12.*"
# dependencies = [
#     "kokoro==0.9.4",
#     "transformers>=4.40",
#     "numpy",
#     "soundfile",
#     "en-core-web-sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
# ]
# ///
"""Generate the narration track for the explainer from build/narration.vtt with Kokoro-82M.

Runs as a standalone uv script on Python 3.12, since Kokoro does not support 3.14; the
spaCy model is a declared dependency because uv environments have no pip for misaki to
download it with. Each cue's speech is placed at its start time on a silent track exactly
as long as the video. The build fails, listing the cues to widen, if any cue does not fit.
"""

import argparse
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

from narrator import SAMPLE_RATE, Clip, Narrator
from vtt import parse_vtt


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    Returns:
        Parsed arguments.
    """
    parser = argparse.ArgumentParser(description="Generate the narration WAV from the WebVTT script.")
    parser.add_argument("--vtt", type=Path, default=Path("build/narration.vtt"), help="narration cues")
    parser.add_argument("--video", type=Path, default=Path("build/explainer.mp4"), help="video whose length the track matches")
    parser.add_argument("--out", type=Path, default=Path("build/narration.wav"), help="output WAV")
    parser.add_argument("--voice", default="af_heart", help="Kokoro voice name")
    parser.add_argument("--max-speed", type=float, default=1.1, help="highest Kokoro speed used to fit a cue")
    parser.add_argument("--margin", type=float, default=0.1, help="seconds left free at the end of each cue")
    return parser.parse_args()


def probe_duration(video: Path) -> float:
    """Read a video's duration with ffprobe.

    Args:
        video: Video file.

    Returns:
        Duration in seconds.
    """
    command = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(video)]
    return float(subprocess.run(command, capture_output=True, text=True, check=True).stdout)


def assemble(clips: list[Clip], seconds: float) -> np.ndarray:
    """Place each clip at its cue start on a silent track.

    Args:
        clips: Clips in playback order; cue windows do not overlap.
        seconds: Track length in seconds.

    Returns:
        Mono float32 samples at SAMPLE_RATE.

    Raises:
        ValueError: If a clip extends past the end of the track.
    """
    track = np.zeros(math.ceil(seconds * SAMPLE_RATE), dtype=np.float32)
    for clip in clips:
        start = round(clip.cue.start * SAMPLE_RATE)
        end = start + clip.audio.size
        if end > track.size:
            raise ValueError(f"cue {clip.cue.ident} ends at {end / SAMPLE_RATE:.2f}s, past the {seconds:.2f}s video")
        track[start:end] = clip.audio
    return track


def main() -> None:
    """Speak every cue, fail on overruns, and write the full-length track."""
    args = parse_args()
    cues = parse_vtt(args.vtt.read_text(encoding="utf-8"))
    seconds = probe_duration(args.video)
    narrator = Narrator(args.voice, args.max_speed, args.margin)
    clips: list[Clip] = []
    for cue in cues:
        clip = narrator.fit(cue)
        status = f"OVERRUN {clip.overrun:.2f}s" if clip.overrun else "ok"
        print(f"{cue.ident:<14} {clip.seconds:5.2f}s of {clip.window:5.2f}s  speed {clip.speed:.2f}  {status}")
        clips.append(clip)
    overruns = [clip.cue.ident for clip in clips if clip.overrun]
    if overruns:
        sys.exit(f"narrate: {len(overruns)} cue(s) do not fit even at speed {args.max_speed}; widen them in storyboard.toml: {', '.join(overruns)}")
    track = assemble(clips, seconds)
    sf.write(args.out, track, SAMPLE_RATE, subtype="PCM_16")
    print(f"wrote {args.out} ({seconds:.2f}s, peak {np.abs(track).max():.2f})")


if __name__ == "__main__":
    main()
