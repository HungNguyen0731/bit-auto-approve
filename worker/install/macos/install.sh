#!/bin/zsh
set -euo pipefail

package_path="${1:-}"
pair_url="${2:-}"
if [[ -z "$package_path" ]]; then
  echo "Usage: install.sh <package.pkg> [bitbucket-pr-worker://pair?... ]" >&2
  exit 2
fi

/usr/sbin/installer -pkg "$package_path" -target /
if [[ -n "$pair_url" ]]; then
  /usr/bin/open "$pair_url"
fi
