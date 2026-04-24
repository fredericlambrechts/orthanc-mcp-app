# syntax=docker/dockerfile:1.7

# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Install deps (cached on package*.json)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy sources
COPY tsconfig.json ./
COPY vitest.config.ts ./
COPY src ./src
COPY ui ./ui

# Compile TS + build UI bundle
RUN npx tsc
RUN npm run build:ui

# ---- Runtime stage ----
FROM node:22-alpine
WORKDIR /app

# Install prod deps only
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --omit=dev

# Copy compiled output and bundled assets
COPY --from=build /app/dist ./dist
COPY --from=build /app/ui ./ui
# If ohif-dist/ is present in the build context, copy it. Empty otherwise -
# the /ohif/viewer route falls back to the placeholder. See README.md for
# instructions on dropping in a real OHIF v3 build.
COPY ohif-dist* ./ohif-dist

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

CMD ["node", "dist/server.js"]
