FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; } || { echo "no git"; exit 1; }; }
COPY repo/ /app
WORKDIR /app
WORKDIR /app
RUN npm install --no-save --no-package-lock       typescript@5.7.2       vitest@2.1.8       @types/node@22.10.2
RUN node -e "const {execFileSync}=require('node:child_process');const v=execFileSync('node_modules/.bin/tsc',['--version'],{encoding:'utf8'}).trim();if(!v.includes('5.7.2'))throw new Error('tsc is '+v);console.log(v)"
RUN node -e "for (const m of ['typescript','vitest','@types/node']) { const p=require('/app/node_modules/'+m+'/package.json'); console.log(m, p.version); }"
RUN rm -f /app/package.json /app/package-lock.json
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
