# Multi-stage Dockerfile for Red 10.
#
# Builds the full monorepo and produces an image that runs the Node.js server
# and (optionally) serves the built client from the same process.
#
# Works on Fly.io, Render, Railway, Koyeb, and any platform that accepts a
# Dockerfile and forwards WebSocket upgrades.
#
# Build:   docker build -t red10 .
# Run:     docker run -p 3001:3001 -e SERVE_CLIENT=true -e CORS_ORIGIN=* red10

# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install all workspace package.json files first so Docker can cache the
# `npm install` step when only source changes.
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

RUN npm install --no-audit --no-fund

# Now copy the rest of the source and build everything
COPY tsconfig.base.json ./
COPY packages ./packages

RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy workspace manifests
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/server/package.json ./packages/server/
COPY --from=builder /app/packages/client/package.json ./packages/client/

# Production install — only server + shared need runtime deps. The client is
# static files, no runtime deps.
RUN npm install --omit=dev --no-audit --no-fund

# Copy built output
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/client/dist ./packages/client/dist

EXPOSE 3001
# By default also serve the built client so this is a single-URL deploy.
# Override by setting SERVE_CLIENT=false if you host the client elsewhere.
ENV SERVE_CLIENT=true

# Drop root. node:20-alpine ships with a non-root `node` user (uid 1000).
# Running unprivileged limits blast radius if any future dep vuln or
# misconfig produces code execution inside the container.
RUN chown -R node:node /app
USER node

CMD ["node", "packages/server/dist/index.js"]
