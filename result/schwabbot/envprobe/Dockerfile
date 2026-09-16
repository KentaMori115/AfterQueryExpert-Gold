FROM python:3.12-slim
RUN command -v git >/dev/null 2>&1 || { { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; } || apk add --no-cache git; }
COPY repo/ /app
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    SBOT_OFFLINE=1 \
    DJANGO_SETTINGS_MODULE=SchwabOptionBot.settings
RUN pip install --no-cache-dir \
    Django==5.1.5 \
    daphne==4.1.2 \
    channels==4.2.0 \
    django-cors-headers==4.6.0 \
    pytz==2024.2 \
    requests==2.32.3 \
    httpx==0.28.1 \
    schedule==1.2.2 \
    websocket-client==1.8.0 \
    aiofiles==24.1.0 \
    schwab-py==1.5.1
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null || true
