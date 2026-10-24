#!/bin/sh
set -ex

export DATABASE_URL="${DATABASE_URL:-file:/data/ghostfolio.db}"
DB_FILE=$(echo "$DATABASE_URL" | sed 's|^file:||')

echo "[1/4] Starting embedded in-container Redis daemon..."
redis-server \
  --daemonize yes \
  --bind 127.0.0.1 \
  --port "${REDIS_PORT:-6379}" \
  --save "" \
  --appendonly no \
  --maxmemory 64mb \
  --maxmemory-policy allkeys-lru

echo "[2/4] Pushing Prisma schema to SQLite ($DATABASE_URL)..."
npx prisma db push

if [ -f "$DB_FILE" ]; then
  echo "[2.5/4] Enabling SQLite WAL mode on $DB_FILE..."
  sqlite3 "$DB_FILE" "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;"
fi

echo "[3/4] Seeding default database tags..."
npx prisma db seed || true

echo "[4/4] Starting Ghostfolio server (SQLite + embedded Redis)..."
exec node main
