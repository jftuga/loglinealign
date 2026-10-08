"""Rewrite narration text into forms the text-to-speech model reads correctly.

Clock times are spelled out the way a speaker says them, because Kokoro's G2P reads
"10:07" as "ten zero seven". Times are converted by rule rather than listed, since the
narration's times are filled in from the generated logs. The lexicon holds only terms the
G2P gets wrong: it already reads I/O, HBA, OS, API, UTC, and SQL Server ("sequel") correctly,
and spacing acronyms out ("H B A") makes it read a lone "A" as the article.
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

LEXICON: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(rf"\b{re.escape(term)}\b"), replacement)
    for term, replacement in (
        ("loglinealign", "log line align"),
    )
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
        Text with clock times and lexicon terms spelled out.
    """
    text = CLOCK_TIME.sub(clock_words, text)
    for pattern, replacement in LEXICON:
        text = pattern.sub(replacement, text)
    return text
