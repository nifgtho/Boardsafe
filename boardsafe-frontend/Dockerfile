FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
ARG NEXT_PUBLIC_BOARDSAFE_API_URL=/api/v1
ARG NEXT_PUBLIC_BOARDSAFE_WS_URL=/api/v1/ws/events
ARG NEXT_PUBLIC_MAPTILER_KEY=
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_BOARDSAFE_API_URL=$NEXT_PUBLIC_BOARDSAFE_API_URL \
    NEXT_PUBLIC_BOARDSAFE_WS_URL=$NEXT_PUBLIC_BOARDSAFE_WS_URL \
    NEXT_PUBLIC_MAPTILER_KEY=$NEXT_PUBLIC_MAPTILER_KEY
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
