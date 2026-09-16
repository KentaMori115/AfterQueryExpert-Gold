FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; } || apk add --no-cache git || microdnf -y install git || dnf -y install git || yum -y install git || { echo "PLATFORM ERROR: this base image has no git, and no apt-get/apk/dnf/yum to install it. Use one of the approved base images, or add git to the image yourself."; exit 1; }; }
COPY repo/ /app
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /ctx
RUN if [ -d /ctx/repo/.git ]; then mkdir -p /app && cp -a /ctx/repo/. /app/; elif [ -f /ctx/package.json ]; then mkdir -p /app && cp -a /ctx/. /app/ && rm -f /app/Dockerfile; fi && rm -rf /ctx
RUN mkdir -p /opt/deps && cp /app/package.json /app/package-lock.json /opt/deps/ && cd /opt/deps && npm ci --no-audit --no-fund
RUN rm -rf /app/node_modules
RUN test -x /opt/deps/node_modules/.bin/jest && test -d /opt/deps/node_modules/ts-jest && test -d /opt/deps/node_modules/jest-cli && test -d /opt/deps/node_modules/supertest && echo "deps ok at /opt/deps"
RUN chmod a+rx /opt /opt/deps && chmod -R a+rX /opt/deps
RUN cd /app && git config --global --add safe.directory /app && echo "--- git status --porcelain --ignored ---" && git status --porcelain --ignored && test -z "$(git status --porcelain --ignored)" && echo "checkout at /app is pristine at $(git rev-parse HEAD)"
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
