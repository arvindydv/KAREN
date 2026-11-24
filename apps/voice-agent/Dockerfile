# syntax=docker/dockerfile:1.7
# KAREN voice agent (LiveKit worker). Build context: apps/voice-agent.
#   docker build -t karen/voice-agent:dev apps/voice-agent

FROM ghcr.io/astral-sh/uv:0.13.9 AS uv

FROM python:3.14-slim-trixie AS builder
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON=/usr/local/bin/python3.12
WORKDIR /app
COPY pyproject.toml uv.lock .python-version README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

FROM python:3.14-slim-trixie AS runtime
RUN groupadd --system --gid 10001 karen \
    && useradd --system --uid 10001 --gid karen --no-create-home --shell /usr/sbin/nologin karen
WORKDIR /app
COPY --from=builder /app /app
# KAREN_DEPLOYED_ARTIFACT: settings refuse an implicit APP_ENV (fail closed, ADR-0013).
ENV PATH="/app/.venv/bin:${PATH}" \
    KAREN_DEPLOYED_ARTIFACT=true \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VOICE_AGENT_HEALTH_PORT=8200
USER 10001:10001
EXPOSE 8200
# The LiveKit worker HTTP server returns 503 until it is registered with LiveKit.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('VOICE_AGENT_HEALTH_PORT', '8200') + '/', timeout=3)"]
ENTRYPOINT ["karen-voice"]
CMD ["start"]
