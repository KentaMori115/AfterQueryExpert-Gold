FROM node:24-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY ecosystem-lab ./ecosystem-lab
COPY docs ./docs
COPY tsconfig.json tsconfig.base.json tsconfig.eslint.json ./
COPY eslint.config.js .prettierrc.json .prettierignore ./
COPY vitest.shared.ts vitest.unit.config.ts vitest.biomes.config.ts vitest.properties.config.ts vitest.cli.config.ts ./
COPY scripts ./scripts
RUN npm ci
RUN npm run typecheck
RUN npm test
