# Local rebuild of the platform generator's own recipe for a Node repository,
# taken from result/sagemark-48bf/env-log.v1.txt (the previous snapshot under
# this same repository name).
FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
COPY repo/ /app
WORKDIR /app
RUN npm ci
RUN npx vitest run --reporter=dot
RUN git config --global --add safe.directory /app
