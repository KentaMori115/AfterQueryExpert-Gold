FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; } || apk add --no-cache git || microdnf -y install git || dnf -y install git || yum -y install git || { echo "PLATFORM ERROR: this base image has no git, and no apt-get/apk/dnf/yum to install it. Use one of the approved base images, or add git to the image yourself."; exit 1; }; }
COPY repo/ /app
WORKDIR /app
RUN npm ci --no-audit --no-fund  && npm run format  && npm run typecheck  && npm run lint  && npm test  && npm run build  && node dist/bin/portfire.js check examples/autumn/show.pf --catalog examples/autumn/house.csv --rig examples/autumn/autumn.rig --audience 200 --stats  && node dist/bin/portfire.js table examples/autumn/show.pf --catalog examples/autumn/house.csv --rig examples/autumn/autumn.rig --out /tmp/panel.csv  && test -s /tmp/panel.csv  && node dist/bin/portfire.js lint examples/autumn/show.pf --follow  && rm -rf dist dist-bench coverage /tmp/panel.csv  && npm cache clean --force
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
