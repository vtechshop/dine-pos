# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY backend/package.json             ./

EXPOSE 5000

CMD ["node", "dist/server.js"]
