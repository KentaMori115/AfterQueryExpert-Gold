# Local reconstruction of platform environment v1 for repo 5CviKRq9xQSJMXtliovF
# (gold-repo-tg-storage-api-5cvikr:v1), transcribed from `gold_bot.py env-log`.
FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /opt/task-npm \
  && printf '%s\n' '{"name":"aq-verifier-deps","private":true,"dependencies":{"jest":"29.7.0","ts-jest":"29.2.5","typescript":"5.8.3","@types/jest":"29.5.14","@types/node":"^20","@types/bcrypt":"6.0.0","uuid":"11.1.0","sharp":"0.35.3","bcrypt":"6.0.0","firebase-admin":"13.4.0"}}' > /opt/task-npm/package.json \
  && cd /opt/task-npm \
  && npm install \
  && rm -rf /opt/task-node_modules \
  && mv node_modules /opt/task-node_modules \
  && rm -rf /opt/task-npm \
  && mkdir -p /app \
  && cp -r /opt/task-node_modules /app/node_modules
ENV PATH="/opt/task-node_modules/.bin:${PATH}"
ENV NODE_PATH="/opt/task-node_modules"
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
