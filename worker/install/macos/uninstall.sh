#!/bin/zsh
set -euo pipefail

delete_credentials=false
if [[ "${1:-}" == "--delete-credentials" ]]; then
  delete_credentials=true
fi

user_id="$(id -u)"
plist_path="$HOME/Library/LaunchAgents/com.hungnv.bitbucket-pr-worker.plist"
launchctl bootout "gui/$user_id/com.hungnv.bitbucket-pr-worker" >/dev/null 2>&1 || true

if [[ -e "/Applications/Bitbucket PR Worker.app" ]]; then
  /usr/bin/osascript -e 'tell application "Finder" to delete POSIX file "/Applications/Bitbucket PR Worker.app"'
fi
if [[ -e "$plist_path" ]]; then
  /usr/bin/osascript -e "tell application \"Finder\" to delete POSIX file \"$plist_path\""
fi

if [[ "$delete_credentials" == true ]]; then
  helper_path="${BITBUCKET_WORKER_KEYCHAIN_HELPER:-}"
  if [[ -x "$helper_path" ]]; then
    for service in \
      com.hungnv.bitbucket-pr-worker.identity \
      com.hungnv.bitbucket-pr-worker.credential \
      com.hungnv.bitbucket-pr-worker.bitbucket-token; do
      "$helper_path" delete "$service" default >/dev/null 2>&1 || true
    done
  fi
fi
