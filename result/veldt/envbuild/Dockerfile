FROM python:3.12-slim
RUN command -v git >/dev/null 2>&1 || { { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; } || apk add --no-cache git; }
COPY repo/ /app
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pytest==9.1.1
RUN git config --system --add safe.directory /app \
    && git config --system user.name "Veldt Agent" \
    && git config --system user.email "agent@veldt.invalid" \
    && git config --system init.defaultBranch main
WORKDIR /app
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
