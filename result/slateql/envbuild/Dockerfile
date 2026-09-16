FROM python:3.12-slim
RUN command -v git >/dev/null 2>&1 || { { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; } || apk add --no-cache git; }
COPY repo/ /app
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir \
        pytest==8.3.4 \
        ruff==0.16.4
WORKDIR /app
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
