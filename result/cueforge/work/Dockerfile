FROM python:3.12-slim

WORKDIR /app
COPY requirements.lock /tmp/requirements.lock
RUN python -m pip install \
    --no-cache-dir \
    -r /tmp/requirements.lock
