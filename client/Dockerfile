# syntax=docker/dockerfile:1

# ---- Stage 1: build the static export ----
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* variables are inlined into the JS bundle at build time, so the
# API base URL must be supplied here. It MUST be reachable from the BROWSER
# (not the Docker network): e.g. http://localhost:3001 for local/compose,
# https://api.example.com for production. Do NOT use the compose service name.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stage 2: serve the static files with nginx ----
FROM nginx:alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
