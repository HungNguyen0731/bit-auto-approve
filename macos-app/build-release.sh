#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
[[ "$#" -le 1 ]] || { print -u2 'Usage: build-release.sh [output-directory]'; exit 1; }
output_dir="${1:-$script_dir/releases}"
output_dir="${output_dir:A}"
[[ ! -L "$output_dir" ]] || { print -u2 'Output directory must not be a symlink.'; exit 1; }
[[  "$(/usr/bin/uname -m)" == "arm64" ]] || { print -u2 'Build the downloadable app on an Apple Silicon Mac.'; exit 1; }

/bin/zsh "$script_dir/build.sh"

app="$script_dir/dist/Bitbucket PR Approver.app"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
archive="$output_dir/Bitbucket-PR-Approver-${version}-macOS.zip"

/usr/bin/codesign --verify --deep --strict "$app"
/bin/mkdir -p "$output_dir"
package="$(/usr/bin/mktemp -d "$output_dir/.gitpulse-package.XXXXXX")"
# Only this private mktemp packaging directory is removed, never output artifacts.
trap '[[ "$package" == "$output_dir/.gitpulse-package."* && -d "$package" && ! -L "$package" ]] && /bin/rm -rf -- "$package"' EXIT
/usr/bin/ditto "$app" "$package/Bitbucket PR Approver.app"
/bin/cp "$script_dir/install-gitpulse.command" "$script_dir/USAGE.txt" "$package/"
/bin/chmod 755 "$package/install-gitpulse.command"
/usr/bin/printf '%s\n' "$version" > "$package/GitPulse-version.txt"
/usr/bin/ditto -c -k --sequesterRsrc "$package" "$archive"
/usr/bin/unzip -tq "$archive" >/dev/null
digest="$(/usr/bin/shasum -a 256 "$archive" | /usr/bin/awk '{print $1}')"
size="$(/usr/bin/stat -f '%z' "$archive")"
manifest="$output_dir/mac-app-update.json"
/usr/bin/printf '{"tag":"v%s","name":"Bitbucket-PR-Approver-%s-macOS.zip","size":%s,"digest":"sha256:%s","downloadUrl":"https://github.com/HungNguyen0731/bit-auto-approve/releases/download/v%s/Bitbucket-PR-Approver-%s-macOS.zip"}\n' "$version" "$version" "$size" "$digest" "$version" "$version" > "$manifest"
print "$digest  $archive"
print "Built $archive"
pulse_archive="$output_dir/GitPulse-${version}-macOS.zip"
/bin/ln -shf "Bitbucket-PR-Approver-${version}-macOS.zip" "$pulse_archive"
print "Linked $pulse_archive"
print "Built $manifest (upload it as a second asset in the GitHub Release)"
