FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build && rm build/*.map

FROM alpine:latest

WORKDIR /app

COPY --from=builder /app/build ./

RUN apk add --no-cache nodejs

ENV NODE_ENV=production

EXPOSE 8888

VOLUME ["/app/uploads"]

CMD ["node", "index.mjs"]
