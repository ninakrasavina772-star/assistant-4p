# Self-hosted deploy (VPS / Yandex Cloud). См. deploy/setup-server.sh
FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY scripts/copy-podruzhka-fonts.mjs ./scripts/copy-podruzhka-fonts.mjs
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_ORIGIN=
ARG BUILD_TIME=dev
ARG BUILD_ID=local
ENV NEXT_PUBLIC_APP_ORIGIN=$NEXT_PUBLIC_APP_ORIGIN
ENV BUILD_TIME=$BUILD_TIME
ENV BUILD_ID=$BUILD_ID
RUN npm run build
RUN printf '{"buildId":"%s","buildTime":"%s"}\n' "$BUILD_ID" "$BUILD_TIME" > public/build-info.json

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ARG BUILD_TIME=dev
ARG BUILD_ID=local
ENV BUILD_TIME=$BUILD_TIME
ENV BUILD_ID=$BUILD_ID
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/undici ./node_modules/undici
COPY --from=builder /app/node_modules/@fastify ./node_modules/@fastify
COPY --from=builder /app/scripts/start-with-openai-proxy.mjs ./start-with-openai-proxy.mjs
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "start-with-openai-proxy.mjs"]
