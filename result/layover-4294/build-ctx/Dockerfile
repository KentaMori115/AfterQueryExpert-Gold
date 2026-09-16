FROM python:3.12-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
RUN apt-get update  && apt-get install -y --no-install-recommends git  && rm -rf /var/lib/apt/lists/*
ENV PYTHONUNBUFFERED=1     PYTHONDONTWRITEBYTECODE=1
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
