# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Builder: produce the single-file bundle (build/index.mjs + seed.mjs)
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run bundle && rm -f build/*.map

# ---------------------------------------------------------------------------
# Migrator: Prisma CLI image, runs `prisma migrate deploy`
# Build with:  docker build --target migrate -t obsidian-api-migrate .
# ---------------------------------------------------------------------------
FROM node:24-alpine AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# Runtime: only runs the bundled app (default target)
# Build with:  docker build -t obsidian-api .
# ---------------------------------------------------------------------------
FROM alpine:latest AS runtime
WORKDIR /app
RUN apk add --no-cache nodejs
ENV NODE_ENV=production
COPY --from=builder /app/build ./
EXPOSE 3001
VOLUME ["/app/uploads"]
CMD ["node", "index.mjs"]
