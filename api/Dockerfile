# API container: Node 20 + docker CLI (spawns sibling runner containers via
# the mounted Docker socket; see docker-compose.yml and the README warning).
FROM node:20-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/package.json
RUN npm ci --workspace api --include-workspace-root=false

COPY api api
WORKDIR /app/api

ENV PORT=3001
EXPOSE 3001
CMD ["npx", "tsx", "src/server.ts"]
