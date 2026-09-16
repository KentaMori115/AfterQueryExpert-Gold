FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
RUN npm install --no-save --no-package-lock typescript@5.7.2 vitest@2.1.8 @types/node@22.10.2
RUN rm -f /app/package.json /app/package-lock.json
RUN git config --global --add safe.directory /app
