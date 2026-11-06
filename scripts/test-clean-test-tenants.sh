#!/usr/bin/env bash
set -euo pipefail
database="$(mktemp /tmp/edocbr-clean-test-tenants.XXXXXX.db)"
images_root="$(mktemp -d /tmp/edocbr-clean-test-images.XXXXXX)"
cleanup() { rm -f "$database" "$database-journal" "$database-wal" "$database-shm"; rm -rf "$images_root"; }
trap cleanup EXIT
DATABASE_URL="file:$database" bunx prisma db push --skip-generate > /dev/null
DATABASE_URL="file:$database" PARLIAMENTARIAN_IMAGES_ROOT="$images_root" bun test tests/clean-test-tenants.test.ts
