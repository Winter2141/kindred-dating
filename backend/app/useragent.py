"""Turn a User-Agent header into the short label shown in the list of signed-in devices.

Only the handful of browsers and systems people actually sign in from are recognised; this
is for a human-readable hint ("Safari on iPhone"), not for feature detection.
"""

import re
from dataclasses import dataclass

# Order matters: Edge and Opera also say "Chrome", and Chrome also says "Safari".
_BROWSERS: tuple[tuple[str, str], ...] = (
    (r"Edg(?:e|A|iOS)?/", "Edge"),
    (r"OPR/|Opera", "Opera"),
    (r"SamsungBrowser/", "Samsung Internet"),
    (r"Firefox/|FxiOS/", "Firefox"),
    (r"Chrome/|CriOS/", "Chrome"),
    (r"Version/[\d.]+.*Safari/", "Safari"),
)

_SYSTEMS: tuple[tuple[str, str], ...] = (
    (r"iPhone", "iPhone"),
    (r"iPad", "iPad"),
    (r"Android", "Android"),
    (r"Windows", "Windows"),
    (r"Mac OS X|Macintosh", "macOS"),
    (r"CrOS", "ChromeOS"),
    (r"Linux", "Linux"),
)


@dataclass(frozen=True)
class Device:
    browser: str | None
    system: str | None
    mobile: bool

    @property
    def label(self) -> str:
        if self.browser and self.system:
            return f"{self.browser} on {self.system}"
        return self.browser or self.system or "Unknown device"


def _first(patterns: tuple[tuple[str, str], ...], user_agent: str) -> str | None:
    for pattern, name in patterns:
        if re.search(pattern, user_agent):
            return name
    return None


def parse(user_agent: str) -> Device:
    if not user_agent.strip():
        return Device(browser=None, system=None, mobile=False)
    if user_agent.startswith(("python-httpx", "testclient", "curl/")):
        return Device(browser="Script", system=None, mobile=False)
    system = _first(_SYSTEMS, user_agent)
    return Device(
        browser=_first(_BROWSERS, user_agent),
        system=system,
        mobile=system in {"iPhone", "Android"} or "Mobile" in user_agent,
    )
