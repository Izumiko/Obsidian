# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Builder: produce the single-file bundle (build/index.mjs + seed.mjs)
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run bundle && rm -f build/*.map

# ---------------------------------------------------------------------------
# Migrator: Prisma CLI image, runs the Prisma 8 migration flow
# Build with:  docker build --target migrate -t obsidian-api-migrate .
# ---------------------------------------------------------------------------
FROM node:24-alpine AS migrate
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=UTC
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
CMD ["pnpm", "exec", "prisma", "db", "migrate", "--advance-ref", "db"]

# ---------------------------------------------------------------------------
# Runtime: only runs the bundled app (default target)
# Build with:  docker build -t obsidian-api .
# ---------------------------------------------------------------------------
FROM alpine:latest AS runtime
WORKDIR /app
RUN apk add --no-cache nodejs
ENV NODE_ENV=production
ENV TZ=UTC
COPY --from=builder /app/build ./
EXPOSE 3001
VOLUME ["/app/uploads"]
CMD ["node", "index.mjs"]
