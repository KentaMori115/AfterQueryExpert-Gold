# Rebuilt verbatim from the platform env-log for repo 62K48OhILrG3idHZAX17 v2.
FROM python:3.12-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
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
# Local stand-in for the platform's Step 7: the platform /app IS a git checkout at
# base_commit; our COPY has no .git, so make one before the same git config runs.
RUN git config --global --add safe.directory /app \
 && cd /app \
 && git init -q -b main \
 && git -c user.name=base -c user.email=base@local commit -q --allow-empty -m init \
 && git add -A \
 && git -c user.name=base -c user.email=base@local commit -q -m "base snapshot" \
 && git config core.hooksPath /dev/null \
 && git rev-parse HEAD > /BASE_SHA
