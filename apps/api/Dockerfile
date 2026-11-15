FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspaces --include-workspace-root --no-audit --no-fund
COPY apps/api ./apps/api
RUN npm run build -w @studio/api
RUN npm prune --omit=dev --workspaces --include-workspace-root --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/migrations ./apps/api/migrations
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]

