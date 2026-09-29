#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
[[ "$(/usr/bin/uname -m)" == "arm64" ]] || { print -u2 'Build the downloadable app on an Apple Silicon Mac.'; exit 1; }

/bin/zsh "$script_dir/build.sh"

app="$script_dir/dist/Bitbucket PR Approver.app"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
archive="$script_dir/releases/Bitbucket-PR-Approver-${version}-macOS.zip"

/usr/bin/codesign --verify --deep --strict "$app"
/bin/mkdir -p "$script_dir/releases"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
/usr/bin/unzip -tq "$archive" >/dev/null
/usr/bin/shasum -a 256 "$archive"
print "Built $archive"
