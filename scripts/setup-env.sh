#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_EXAMPLE="$ROOT_DIR/.env.example"
ENV_FILE="$ROOT_DIR/.env"

if [ ! -f "$ENV_EXAMPLE" ]; then
  echo "Missing .env.example in $ROOT_DIR"
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  echo ".env already exists. Leaving it unchanged."
  exit 0
fi

cp "$ENV_EXAMPLE" "$ENV_FILE"

# Local defaults for development.
# macOS/BSD sed requires backup extension argument.
sed -i '' 's/^HOST=.*/HOST=127.0.0.1/' "$ENV_FILE"
sed -i '' 's/^NODE_ENV=.*/NODE_ENV=development/' "$ENV_FILE"

echo "Created .env with local defaults."
echo "Run: npm run start"
