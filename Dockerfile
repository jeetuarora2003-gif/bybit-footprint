# ═══════════════════════════════════════════════════════════════════
#  Bybit Footprint — Multi-stage Dockerfile
#  Builds Go backend + React frontend into a single container.
#  Exposes:  8080 (WebSocket)  |  3000 (UI via serve)
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: Build the Go backend ─────────────────────────────────
FROM golang:1.23-alpine AS backend-builder

WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/*.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /footprint .

# ── Stage 2: Build the React frontend ────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --silent

COPY frontend/ ./
RUN npm run build

# ── Stage 3: Production runtime ─────────────────────────────────
FROM alpine:3.19

# Install Node.js (lightweight, needed for serve) and ca-certificates (for WSS)
RUN apk add --no-cache ca-certificates nodejs npm \
    && npm install -g serve@14 \
    && apk del npm 2>/dev/null; true

# Copy artefacts
COPY --from=backend-builder /footprint /usr/local/bin/footprint
COPY --from=frontend-builder /app/frontend/dist /srv/ui

# Tiny entrypoint that starts both processes
COPY <<'EOF' /entrypoint.sh
#!/bin/sh
set -e

echo "▶  Starting Go backend on :8080"
/usr/local/bin/footprint &

echo "▶  Starting UI on :3000"
serve -s /srv/ui -l 3000 &

wait -n
EOF

RUN chmod +x /entrypoint.sh

EXPOSE 8080 3000

ENTRYPOINT ["/entrypoint.sh"]
