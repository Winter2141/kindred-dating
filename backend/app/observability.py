"""Request IDs, structured logs and Prometheus metrics, without extra dependencies.

- Every HTTP request gets an id (taken from a well-formed X-Request-ID header, or made up),
  which is echoed back in the response and attached to every log line written while
  handling it, so one request can be followed through the logs.
- With KINDRED_LOG_FORMAT=json, logs come out as one JSON object per line.
- GET /metrics serves request counts, latency histograms and live WebSocket numbers in the
  Prometheus text format. Set KINDRED_METRICS_TOKEN to require a bearer token for it.
"""

import json
import logging
import re
import time
import uuid
from bisect import bisect_left
from collections import defaultdict
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

_VALID_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
access_log = logging.getLogger("kindred.access")


class Metrics:
    """Counters and histograms keyed by label values, rendered in Prometheus text format."""

    BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)

    def __init__(self) -> None:
        self.requests: dict[tuple[str, str, str], int] = defaultdict(int)
        self._durations: dict[tuple[str, str], list[int]] = {}
        self._sums: dict[tuple[str, str], float] = defaultdict(float)
        self._counts: dict[tuple[str, str], int] = defaultdict(int)

    def observe(self, method: str, route: str, status: int, seconds: float) -> None:
        self.requests[(method, route, str(status))] += 1
        key = (method, route)
        buckets = self._durations.setdefault(key, [0] * len(self.BUCKETS))
        index = bisect_left(self.BUCKETS, seconds)
        if index < len(buckets):
            buckets[index] += 1
        self._sums[key] += seconds
        self._counts[key] += 1

    def render(self, gauges: dict[str, tuple[str, float]]) -> str:
        lines = [
            "# HELP kindred_http_requests_total HTTP requests handled, by route and status.",
            "# TYPE kindred_http_requests_total counter",
        ]
        for (method, route, status), count in sorted(self.requests.items()):
            labels = _labels(method=method, route=route, status=status)
            lines.append(f"kindred_http_requests_total{{{labels}}} {count}")

        lines += [
            "# HELP kindred_http_request_duration_seconds Time to handle HTTP requests.",
            "# TYPE kindred_http_request_duration_seconds histogram",
        ]
        for (method, route), buckets in sorted(self._durations.items()):
            running = 0
            for bound, count in zip(self.BUCKETS, buckets, strict=True):
                running += count
                labels = _labels(method=method, route=route, le=str(bound))
                lines.append(f"kindred_http_request_duration_seconds_bucket{{{labels}}} {running}")
            labels = _labels(method=method, route=route, le="+Inf")
            total = self._counts[(method, route)]
            lines.append(f"kindred_http_request_duration_seconds_bucket{{{labels}}} {total}")
            labels = _labels(method=method, route=route)
            lines.append(
                f"kindred_http_request_duration_seconds_sum{{{labels}}} "
                f"{self._sums[(method, route)]:.6f}"
            )
            lines.append(f"kindred_http_request_duration_seconds_count{{{labels}}} {total}")

        for name, (help_text, value) in gauges.items():
            lines += [f"# HELP {name} {help_text}", f"# TYPE {name} gauge", f"{name} {value:g}"]
        return "\n".join(lines) + "\n"


def _labels(**values: str) -> str:
    escaped = (
        (k, v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n"))
        for k, v in values.items()
    )
    return ",".join(f'{k}="{v}"' for k, v in escaped)


class RequestContextMiddleware:
    """Pure ASGI middleware, so it also sees requests that fail before reaching a route."""

    def __init__(self, app: ASGIApp, metrics: Metrics) -> None:
        self.app = app
        self.metrics = metrics

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = dict(scope["headers"]).get(b"x-request-id", b"").decode("latin-1")
        rid = incoming if _VALID_ID.match(incoming) else uuid.uuid4().hex
        token = request_id.set(rid)
        started = time.perf_counter()
        status = 500

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message.setdefault("headers", [])
                message["headers"] = [*message["headers"], (b"x-request-id", rid.encode())]
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            elapsed = time.perf_counter() - started
            # The route template ("/api/matches/{match_id}") keeps the metrics' labels bounded.
            route = getattr(scope.get("route"), "path", None) or "unmatched"
            if route != "/metrics":
                self.metrics.observe(scope["method"], route, status, elapsed)
            access_log.info(
                "%s %s %s %.1fms",
                scope["method"],
                scope["path"],
                status,
                elapsed * 1000,
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status,
                    "duration_ms": round(elapsed * 1000, 1),
                },
            )
            request_id.reset(token)


class RequestIdFilter(logging.Filter):
    """Adds the current request's id to every log record ("-" outside a request)."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get() or "-"
        return True


# Attributes every LogRecord has; anything else was passed with `extra=` and is kept.
_STANDARD = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {
    "message",
    "asctime",
    "request_id",
    "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if getattr(record, "request_id", "-") != "-":
            entry["request_id"] = record.request_id
        entry.update({k: v for k, v in vars(record).items() if k not in _STANDARD})
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure_logging(log_format: str, level: int = logging.INFO) -> None:
    """Text for people at a terminal, JSON for log collectors."""
    handler = logging.StreamHandler()
    handler.addFilter(RequestIdFilter())
    if log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(levelname)s %(name)s [%(request_id)s]: %(message)s")
        )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
