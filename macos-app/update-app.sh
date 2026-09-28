#!/bin/zsh
set -euo pipefail

candidate="${1:-}"
target="${2:-}"
old_pid="${3:-}"
expected_version="${4:-}"
expected_target="$HOME/Applications/Bitbucket PR Approver.app"

[[ "$target" == "$expected_target" && -d "$candidate" && "$old_pid" == <-> && "$expected_version" == <->.<->.<-> ]] || exit 1
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$candidate/Contents/Info.plist")" == 'com.hungnv.bitbucket-pr-approver.mac' ]] || exit 1
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$candidate/Contents/Info.plist")" == "$expected_version" ]] || exit 1
/usr/bin/codesign --verify --deep --strict "$candidate"

for _ in {1..60}; do
  if ! /bin/kill -0 "$old_pid" 2>/dev/null; then break; fi
  /bin/sleep 1
done
if /bin/kill -0 "$old_pid" 2>/dev/null; then exit 1; fi

/bin/mkdir -p "$HOME/Applications"
backup=""
if [[ -e "$target" ]]; then
  backup="$HOME/Applications/Bitbucket PR Approver.backup-$(/bin/date +%Y%m%d-%H%M%S).app"
  /bin/mv "$target" "$backup"
fi
if ! /bin/mv "$candidate" "$target"; then
  if [[ -n "$backup" ]]; then /bin/mv "$backup" "$target"; fi
  exit 1
fi
/usr/bin/open -n "$target"
