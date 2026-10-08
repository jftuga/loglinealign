"""WebVTT rendering and reading for the narration script.

The narration cues double as subtitles and as the script for a separate audio pass:
each cue's start is when speech begins and its end is the latest it may finish.
The reader accepts the files written here, which is all the narration pass needs.
"""

from cue import Cue


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


def parse_vtt_time(stamp: str) -> float:
    """Parse a WebVTT timestamp as written by vtt_time.

    Args:
        stamp: A timestamp such as "00:01:05.400".

    Returns:
        Time in seconds.

    Raises:
        ValueError: If the timestamp is not HH:MM:SS.mmm.
    """
    parts = stamp.split(":")
    if len(parts) != 3:
        raise ValueError(f"bad WebVTT timestamp {stamp!r}")
    hours, minutes, seconds = parts
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def parse_vtt(text: str) -> list[Cue]:
    """Read cues from a WebVTT document written by render_vtt.

    Args:
        text: The complete WebVTT file content.

    Returns:
        Cues in file order.

    Raises:
        ValueError: If the header is missing or a cue block is not identifier, timing, and text lines.
    """
    blocks = text.replace("\r\n", "\n").strip().split("\n\n")
    if not blocks[0].startswith("WEBVTT"):
        raise ValueError("missing WEBVTT header")
    cues: list[Cue] = []
    for block in blocks[1:]:
        lines = block.strip().split("\n")
        if len(lines) < 3 or " --> " not in lines[1]:
            raise ValueError(f"bad cue block: {block!r}")
        start, end = lines[1].split(" --> ")
        cues.append(Cue(lines[0], parse_vtt_time(start), parse_vtt_time(end), " ".join(lines[2:])))
    return cues
