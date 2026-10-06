"""Run the real loglinealign CLI for the naive and time-zone-aligned merges.

The video shows exactly the commands executed here and lines from their output, so
the explainer cannot drift from what the tool actually does. Time zone options are
derived from the scenario: the most common offset becomes the global fallback and
every other file gets its own --file-timezone.
"""

import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class MergeResult:
    """Outcome of one loglinealign run.

    Attributes:
        command: Display form of the command, as shown in the video.
        stderr: Text loglinealign wrote to STDERR (warnings).
        output: Path of the merged log.
    """

    command: str
    stderr: str
    output: Path


def timezone_options(files_and_offsets: list[tuple[str, str]]) -> list[str]:
    """Build the fewest time zone options that assign every file its offset.

    Args:
        files_and_offsets: (filename, "±HH:MM") pairs in input order.

    Returns:
        A --timezone option for the most common offset plus --file-timezone options for the rest.
    """
    fallback = Counter(offset for _, offset in files_and_offsets).most_common(1)[0][0]
    options = ["--timezone", fallback]
    for file, offset in files_and_offsets:
        if offset != fallback:
            options.extend(["--file-timezone", file, offset])
    return options


def run_merge(script: Path, log_dir: Path, files: list[str], options: list[str], output: Path) -> MergeResult:
    """Run loglinealign without colors and write the merge to a file.

    Args:
        script: Path to dist/loglinealign.js.
        log_dir: Directory containing the input logs; used as the working directory so labels are bare filenames.
        files: Input filenames relative to log_dir.
        options: Extra command-line options shown in the video.
        output: Destination for the merged log.

    Returns:
        The display command, captured STDERR, and output path.

    Raises:
        FileNotFoundError: If the loglinealign script does not exist.
        RuntimeError: If loglinealign exits unsuccessfully.
    """
    if not script.is_file():
        raise FileNotFoundError(f"loglinealign CLI not found: {script} (run 'make cli' in the repository root)")
    argv = ["node", str(script.resolve()), "-n", *options, "-o", str(output.resolve()), *files]
    result = subprocess.run(argv, cwd=log_dir, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"loglinealign failed ({result.returncode}): {result.stderr.strip()}")
    return MergeResult(" ".join(["loglinealign", *options, *files]), result.stderr.strip(), output)
