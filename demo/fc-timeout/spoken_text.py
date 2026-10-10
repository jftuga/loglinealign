"""Rewrite narration text into forms the text-to-speech model reads correctly.

Clock times are spelled out the way a speaker says them, because Kokoro's G2P reads
"10:07" as "ten zero seven". Times are converted by rule rather than listed, since the
narration's times are filled in from the generated logs. The lexicon holds only terms the
G2P gets wrong, using speech spellings and explicit Kokoro pronunciation hints.
Other acronyms retain their original spelling; spacing them out can change their meaning.
"""

import re

ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
)
TENS = ("", "", "twenty", "thirty", "forty", "fifty")

# 24-hour clock time such as "13:37" or "9:05": an hour 0-23 (one or two digits), a colon,
# and a two-digit minute 00-59. Word boundaries keep it from matching inside longer numbers.
CLOCK_TIME = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")

# Word boundaries avoid replacing parts of longer words. Consume an existing period
# after OS so a sentence ending in "OS." becomes "O.S.", not "O.S..".
LEXICON: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bloglinealign\b"), "log line align"),
    (re.compile(r"\bremerge\b", re.IGNORECASE), "re-merge"),
    (re.compile(r"\bOS\b\.?"), "O.S."),
    (re.compile(r"\bfilename(s?)\b", re.IGNORECASE), r"file name\1"),
    (re.compile(r"\btimezone(s?)\b", re.IGNORECASE), r"time zone\1"),
    # Kokoro's [word](/phonemes/) syntax adds the unstressed vowel before the final n.
    (re.compile(r"\bwritten\b", re.IGNORECASE), r"[\g<0>](/ɹˈɪtən/)"),
)


def number_words(number: int) -> str:
    """Spell out a number from 0 to 59.

    Args:
        number: The number to spell.

    Returns:
        The number in words, such as "thirty-seven".
    """
    if number < 20:
        return ONES[number]
    tens, ones = divmod(number, 10)
    return TENS[tens] if ones == 0 else f"{TENS[tens]}-{ONES[ones]}"


def clock_words(match: re.Match[str]) -> str:
    """Spell out a matched clock time as spoken, such as "ten oh seven".

    Args:
        match: A CLOCK_TIME match.

    Returns:
        The time in words.
    """
    hour = number_words(int(match[1]))
    minute = int(match[2])
    if minute == 0:
        return f"{hour} hundred"
    if minute < 10:
        return f"{hour} oh {ONES[minute]}"
    return f"{hour} {number_words(minute)}"


def spoken(text: str) -> str:
    """Rewrite cue text for speech.

    Args:
        text: Narration text as it appears in the subtitles.

    Returns:
        Text with speech spellings and Kokoro pronunciation hints.
    """
    text = CLOCK_TIME.sub(clock_words, text)
    for pattern, replacement in LEXICON:
        text = pattern.sub(replacement, text)
    return text
