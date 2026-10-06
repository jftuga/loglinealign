"""WebVTT rendering for the narration script.

The narration cues double as subtitles and as the script for a separate audio pass:
each cue's start is when speech begins and its end is the latest it may finish.
"""

from storyboard import Cue


def vtt_time(seconds: float) -> str:
    """Format seconds as a WebVTT timestamp.

    Args:
        seconds: Nonnegative time in seconds.

    Returns:
        A timestamp such as "00:01:05.400".
    """
    millis = round(seconds * 1000)
    hours, rest = divmod(millis, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    secs, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def render_vtt(cues: list[Cue]) -> str:
    """Render cues as a WebVTT document.

    Args:
        cues: Cues in playback order.

    Returns:
        The complete WebVTT file content.
    """
    blocks = [f"{cue.ident}\n{vtt_time(cue.start)} --> {vtt_time(cue.end)}\n{cue.text}\n" for cue in cues]
    return "WEBVTT\n\n" + "\n".join(blocks)
