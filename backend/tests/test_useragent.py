import pytest

from app.useragent import parse


@pytest.mark.parametrize(
    ("user_agent", "label", "mobile"),
    [
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
            "Edge on Windows",
            False,
        ),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like "
            "Gecko) Chrome/141.0.0.0 Safari/537.36",
            "Chrome on macOS",
            False,
        ),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like "
            "Gecko) Version/18.1 Safari/605.1.15",
            "Safari on macOS",
            False,
        ),
        (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, "
            "like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
            "Safari on iPhone",
            True,
        ),
        (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, "
            "like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
            "Chrome on iPhone",
            True,
        ),
        (
            "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like "
            "Gecko) Version/18.1 Safari/604.1",
            "Safari on iPad",
            False,
        ),
        (
            "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/141.0.0.0 Mobile Safari/537.36",
            "Chrome on Android",
            True,
        ),
        (
            "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) "
            "SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
            "Samsung Internet on Android",
            True,
        ),
        (
            "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
            "Firefox on Linux",
            False,
        ),
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/141.0.0.0 Safari/537.36 OPR/124.0.0.0",
            "Opera on Windows",
            False,
        ),
        (
            "Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/141.0.0.0 Safari/537.36",
            "Chrome on ChromeOS",
            False,
        ),
        ("python-httpx/0.28.1", "Script", False),
        ("", "Unknown device", False),
        ("SomethingElse/1.0", "Unknown device", False),
    ],
)
def test_labels(user_agent: str, label: str, mobile: bool) -> None:
    device = parse(user_agent)
    assert device.label == label
    assert device.mobile is mobile
