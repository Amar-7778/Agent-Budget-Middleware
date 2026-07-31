# =============================================================================
# STAGE 1: Frontend React Builder
# =============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# =============================================================================
# STAGE 2: Python Builder
# =============================================================================
FROM python:3.11-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=100 --retries 5 -r requirements.txt


# =============================================================================
# STAGE 3: Final Runtime Image
# =============================================================================
FROM python:3.11-slim AS runner

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    APP_PORT=8000

COPY --from=builder /opt/venv /opt/venv

COPY . /app

# Overwrite static folder with built React frontend
COPY --from=frontend-builder /static /app/static

RUN adduser --system --uid 10001 --group appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

STOPSIGNAL SIGTERM

CMD ["/opt/venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4", "--timeout-graceful-shutdown", "30"]
