#!/bin/bash
# run once after deploy to populate a demo scan
API=${1:-http://localhost/api}
echo "seeding demo scan..."
curl -s -X POST "$API/scan" \
  -H 'Content-Type: application/json' \
  -d '{"seed":"torvalds@linux-foundation.org"}'
echo ""
echo "scan queued — wait ~30s for plugins to finish"
