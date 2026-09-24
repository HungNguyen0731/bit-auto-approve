#!/bin/zsh
set -euo pipefail

resources="${0:A:h}"
support="$HOME/Library/Application Support/BitbucketPRWorker"
export BITBUCKET_WORKER_DATA_DIR="$support"
export BITBUCKET_WORKER_KEYCHAIN_HELPER="$resources/keychain-helper"
origin="$(<"$resources/control-plane-origin")"
config="$support/config.json"
pair_url_path="$support/pair-url"

if [[ -f "$support/terminal-pid" ]] && /bin/kill -0 "$(<"$support/terminal-pid")" 2>/dev/null; then
  echo "Bitbucket PR Worker is already running in another Terminal window."
  exit 0
fi
/usr/bin/printf '%s' "$$" > "$support/terminal-pid"
trap 'rm -f "$support/terminal-pid"' EXIT

if [[ -f "$config" ]] && ! "$resources/node" -e 'const fs=require("node:fs");try{if(new URL(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).controlPlaneUrl).origin!==process.argv[2])process.exit(1)}catch{process.exit(1)}' "$config" "$origin"; then
  echo "This Mac is paired with a different Control Plane. Existing credentials were not changed." >&2
  exit 1
fi
if [[ ! -f "$config" ]]; then
  if [[ ! -f "$pair_url_path" ]]; then
    echo "Pairing link missing. Return to Local Workers and click Run in Terminal again." >&2
    exit 1
  fi
  pair_url="$(<"$pair_url_path")"
  "$resources/node" "$resources/worker-bundle.mjs" --pair-url "$pair_url"
fi
/bin/rm -f "$pair_url_path"
echo "Local Worker running. Keep this window open; press Control-C to stop."
"$resources/node" "$resources/worker-bundle.mjs"
