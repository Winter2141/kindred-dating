"""Spotting messages that read as insults, so the sender gets a moment to reconsider.

This is a nudge, not a filter: nothing is blocked. The web app runs the same patterns (it
gets them from GET /api/meta) to ask "Are you sure?" before sending, and the server marks
messages that match, so moderators can see a pattern when someone is reported.

The patterns are written once here and must stay valid in both Python's `re` and
JavaScript's RegExp: plain character classes, `\\b`, `\\s`, `+`, `?` and `(?:...)` only.
"""

import re
from functools import cache

# Hurtful wherever they appear in a message.
ALWAYS = (
    "idiot",
    "moron",
    "loser",
    "bitch",
    "slut",
    "whore",
    "shut up",
    "kill yourself",
    "kys",
    "go die",
    "nobody wants you",
    "no one wants you",
    "nobody would date you",
    "no one would date you",
)

# Ordinary words that are only an insult when aimed at the reader ("you're so ugly", but
# not "an ugly sweater party").
AIMED = (
    "ugly",
    "stupid",
    "dumb",
    "fat",
    "pathetic",
    "worthless",
    "disgusting",
    "trash",
    "gross",
    "a freak",
    "a creep",
    "a joke",
)

# "you", "you are", "you're", "your", "ur", "u r" ... then maybe "so", "such", "really".
_YOU = r"\b(?:y+o+u+|u+)(?:\s*'?\s*r+e*|\s+a+r+e+)?\s+"
_INTENSIFIER = r"(?:(?:s+o+|r+e+a+l+y+|s+u+c+h+|t+o+t+a+l+y+|j+u+s+t+)\s+)?"

# Digits and symbols people swap in for letters.
_LOOKALIKES = str.maketrans(
    {
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "7": "t",
        "@": "a",
        "$": "s",
        "!": "i",
        "’": "'",
        "‘": "'",
    }
)


def _letters(phrase: str) -> str:
    """'shut up' -> 's+h+u+t+\\s+u+p+', so 'shuuut  up' matches too."""
    return r"\s+".join("".join(f"{re.escape(ch)}+" for ch in word) for word in phrase.split())


def patterns() -> list[str]:
    """The regular expressions, as sources the web app can compile with the 'i' flag."""
    always = [rf"\b{_letters(phrase)}\b" for phrase in ALWAYS]
    aimed = [rf"(?:{_YOU}){_INTENSIFIER}{_letters(word)}\b" for word in AIMED]
    return always + aimed


@cache
def _compiled() -> list[re.Pattern[str]]:
    return [re.compile(source, re.IGNORECASE) for source in patterns()]


def normalise(text: str) -> str:
    return text.lower().translate(_LOOKALIKES)


def unkind_phrases(text: str) -> list[str]:
    """The parts of `text` that read as insults, in the order they appear."""
    if not text:
        return []
    plain = normalise(text)
    found: list[tuple[int, str]] = []
    for pattern in _compiled():
        found.extend((m.start(), m.group(0).strip()) for m in pattern.finditer(plain))
    return [phrase for _, phrase in sorted(found)]


def is_unkind(text: str) -> bool:
    return bool(unkind_phrases(text))
