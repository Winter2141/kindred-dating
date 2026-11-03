FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KINDRED_DATABASE_URL=sqlite+aiosqlite:////data/kindred.db \
    KINDRED_MEDIA_DIR=/data/media

WORKDIR /app
COPY pyproject.toml alembic.ini ./
COPY app ./app
RUN pip install --no-cache-dir ".[postgres,redis]" && mkdir -p /data/media

EXPOSE 8000
# The web container's nginx sets X-Forwarded-For, so rate limits see the real client address.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
