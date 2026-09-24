#!/bin/zsh
set -euo pipefail

resources="${0:A:h}/../Resources"
pair_url="${1:-}"
if [[ "$pair_url" != bitbucket-pr-worker-portable://pair\?* ]]; then
  echo "Expected a Worker pairing link from the Control Plane." >&2
  exit 1
fi
origin="$(<"$resources/control-plane-origin")"
if ! "$resources/node" -e 'const u=new URL(process.argv[1]); const origin=new URL(process.argv[2]); if(u.protocol!=="bitbucket-pr-worker-portable:"||u.hostname!=="pair"||u.searchParams.get("controlPlane")!==origin.origin||!/^[A-Z0-9-]{6,64}$/.test(u.searchParams.get("code")||""))process.exit(1)' "$pair_url" "$origin"; then
  echo "Pairing link is invalid or belongs to a different Control Plane." >&2
  exit 1
fi
support="$HOME/Library/Application Support/BitbucketPRWorker"
/bin/mkdir -p "$support"
/bin/chmod 700 "$support"
/usr/bin/printf '%s' "$pair_url" > "$support/pair-url"
/bin/chmod 600 "$support/pair-url"
/usr/bin/open -a Terminal "$resources/Run Worker.command"
