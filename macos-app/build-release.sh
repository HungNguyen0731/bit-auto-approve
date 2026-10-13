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
digest="$(/usr/bin/shasum -a 256 "$archive" | /usr/bin/awk '{print $1}')"
size="$(/usr/bin/stat -f '%z' "$archive")"
manifest="$script_dir/releases/mac-app-update.json"
/usr/bin/printf '{"tag":"v%s","name":"Bitbucket-PR-Approver-%s-macOS.zip","size":%s,"digest":"sha256:%s","downloadUrl":"https://github.com/HungNguyen0731/bit-auto-approve/releases/download/v%s/Bitbucket-PR-Approver-%s-macOS.zip"}\n' "$version" "$version" "$size" "$digest" "$version" "$version" > "$manifest"
print "$digest  $archive"
print "Built $archive"
pulse_archive="$script_dir/releases/GitPulse-${version}-macOS.zip"
/bin/ln -shf "Bitbucket-PR-Approver-${version}-macOS.zip" "$pulse_archive"
print "Linked $pulse_archive"
print "Built $manifest (upload it as a second asset in the GitHub Release)"
