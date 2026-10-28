#!/usr/bin/env bash
# Trip data (cities, prices, rates) must come from the agent, never from components.
# Comments and the start page's example prompts (TripInputForm.tsx) are allowed.
set -euo pipefail
cd "$(dirname "$0")/.."
hits=$(grep -rnE "Tashkent|Istanbul|Paris|Tokyo|Lisbon|Bali" apps/web/src \
  | grep -v "apps/web/src/components/TripInputForm.tsx" \
  | grep -vE ":[0-9]+:\s*(//|\*|/\*)" || true)
if [ -n "$hits" ]; then
  echo "Hard-coded trip data found in apps/web/src:" >&2
  echo "$hits" >&2
  exit 1
fi
