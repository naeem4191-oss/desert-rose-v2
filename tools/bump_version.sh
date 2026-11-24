#!/bin/zsh
# Sets a new cache-busting version (?v=…) in index.html; main.js picks it up from its own URL.
# Run before committing a deploy that changes any file under js/ or assets/.
set -e
V=${1:-$(date +%Y%m%d%H%M)}
sed -i '' -E "s/\?v=[A-Za-z0-9]+/?v=$V/g" "${0:A:h}/../index.html"
grep -c "?v=$V" "${0:A:h}/../index.html" | xargs echo "index.html: $V in" | sed 's/$/ places/'
