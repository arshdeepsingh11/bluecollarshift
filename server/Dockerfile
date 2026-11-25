# Blue Collar API — multi-stage, non-root, minimal image.
# Build context: the REPOSITORY ROOT (needs ../shared). Example:
#   docker build -f server/Dockerfile -t bluecollar-api .
FROM node:22-alpine AS build
WORKDIR /repo
COPY shared/package.json shared/package-lock.json* shared/
RUN cd shared && npm ci --omit=dev --ignore-scripts
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --ignore-scripts
COPY shared/src shared/src
COPY server/src server/src
COPY server/build.mjs server/tsconfig.json server/
RUN cd server && node build.mjs && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /repo/server/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/server/dist ./dist
COPY --from=build --chown=app:app /repo/server/package.json ./package.json
# Public CA certificate of the database host (Supabase) so TLS is verified.
COPY --chown=app:app server/certs ./certs
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health/ready || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
