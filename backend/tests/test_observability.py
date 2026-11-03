import json
import logging

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.observability import JsonFormatter, Metrics, RequestIdFilter, request_id


def test_requests_get_an_id(client: TestClient) -> None:
    made_up = client.get("/api/health").headers["x-request-id"]
    assert len(made_up) == 32
    kept = client.get("/api/health", headers={"X-Request-ID": "trace-123"})
    assert kept.headers["x-request-id"] == "trace-123"
    # Anything odd is replaced rather than echoed into logs and headers.
    odd = client.get("/api/health", headers={"X-Request-ID": "bad id\nwith newline"})
    assert odd.headers["x-request-id"] != "bad id\nwith newline"


def test_metrics_count_requests_by_route(client: TestClient, make_user) -> None:
    me = make_user()
    client.get("/api/health")
    client.get("/api/matches/1", headers=me.headers)
    client.get("/api/matches/2", headers=me.headers)
    client.get("/nowhere")

    text = client.get("/metrics").text
    assert 'kindred_http_requests_total{method="GET",route="/api/health",status="200"} 1' in text
    # Ids in paths are folded into the route template, so labels stay bounded.
    assert (
        'kindred_http_requests_total{method="GET",route="/api/matches/{match_id}",status="404"} 2'
        in text
    )
    assert 'route="unmatched",status="404"' in text
    assert 'kindred_http_request_duration_seconds_count{method="GET",route="/api/health"} 1' in text
    assert "kindred_websocket_connections 0" in text
    assert 'route="/metrics"' not in text


def test_websocket_gauges(client: TestClient, make_user) -> None:
    me = make_user()
    with client.websocket_connect(f"/ws?token={me.token}") as ws:
        ws.receive_json()
        text = client.get("/metrics").text
        assert "kindred_websocket_connections 1" in text
        assert "kindred_online_users 1" in text


def test_metrics_can_require_a_token(settings: Settings) -> None:
    locked = settings.model_copy(update={"metrics_token": "s3cret"})
    with TestClient(create_app(locked)) as client:
        assert client.get("/metrics").status_code == 401
        ok = client.get("/metrics", headers={"Authorization": "Bearer s3cret"})
        assert ok.status_code == 200
        assert ok.headers["content-type"].startswith("text/plain")


def test_histogram_buckets_are_cumulative() -> None:
    metrics = Metrics()
    for seconds in (0.003, 0.02, 0.02, 3.0, 9.0):
        metrics.observe("GET", "/x", 200, seconds)
    text = metrics.render({})
    assert 'le="0.005"} 1' in text
    assert 'le="0.025"} 3' in text
    assert 'le="5.0"} 4' in text
    assert 'le="+Inf"} 5' in text


def test_json_logs_carry_the_request_id() -> None:
    record = logging.LogRecord(
        "kindred.test", logging.INFO, __file__, 1, "hello %s", ("you",), None
    )
    record.status = 201  # passed with extra=
    token = request_id.set("abc")
    try:
        RequestIdFilter().filter(record)
    finally:
        request_id.reset(token)
    entry = json.loads(JsonFormatter().format(record))
    assert entry["message"] == "hello you"
    assert entry["request_id"] == "abc"
    assert entry["status"] == 201
    assert entry["level"] == "info" and entry["logger"] == "kindred.test"
