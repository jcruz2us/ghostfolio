#!/bin/sh

set -ex

if echo "$DATABASE_URL" | grep -q '^file:'; then
  TMP_SQLITE_SCHEMA=$(mktemp prisma/.schema.sqlite.XXXXXX)
  sed -e 's/provider = "postgresql"/provider = "sqlite"/' \
      -e 's/scopes *String\[\] *@default(\[\])/scopes Json?/' \
      -e 's/settings *Json *@default("{}")/settings Json?/' \
      -e 's/@default("\[\]")//g' \
      -e 's/@default("{}")//g' \
      prisma/schema.prisma > "$TMP_SQLITE_SCHEMA"

  npx prisma db push --schema="$TMP_SQLITE_SCHEMA"
  # The image ships a client generated for PostgreSQL; regenerate it for SQLite
  npx prisma generate --schema="$TMP_SQLITE_SCHEMA" --generator client
  rm -f "$TMP_SQLITE_SCHEMA"

  DB_FILE=$(echo "$DATABASE_URL" | sed 's|^file:||')
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$DB_FILE" ]; then
    sqlite3 "$DB_FILE" "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;"
  fi
else
  echo "Running database migrations"
  npx prisma migrate deploy
fi

echo "Seeding the database"
npx prisma db seed

echo "Starting the server"
exec node main
