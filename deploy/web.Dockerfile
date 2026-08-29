# Production web image: Next.js dashboard + evidence API.
# Build context = repo root (needs workspace packages + lockfile).

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/evidence/package.json packages/evidence/
COPY packages/blockchain/package.json packages/blockchain/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @free-web-mcp/web build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/apps/web/next.config.mjs ./apps/web/
COPY --from=builder /app/apps/web/data ./apps/web/data
COPY --from=builder /app/package.json ./
# runtime source for workspace packages (raw TS is imported directly)
COPY --from=builder /app/packages/evidence/src ./packages/evidence/src
COPY --from=builder /app/packages/blockchain/src ./packages/blockchain/src
COPY --from=builder /app/packages/storage/src ./packages/storage/src

EXPOSE 3000
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
