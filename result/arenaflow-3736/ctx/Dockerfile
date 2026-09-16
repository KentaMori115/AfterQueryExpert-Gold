FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive CI=true NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NPM_CONFIG_UPDATE_NOTIFIER=false NODE_OPTIONS=--max-old-space-size=4096
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm ci
RUN npx vitest run --reporter=dot
RUN git init -q . && git add -A && git -c user.name=base -c user.email=base@local commit -q -m base && git config --global --add safe.directory /app && git config core.hooksPath /dev/null
