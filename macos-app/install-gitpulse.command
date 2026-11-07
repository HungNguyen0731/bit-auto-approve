#!/bin/zsh
set -euo pipefail
# Production destination is intentionally fixed; no environment or argument override.
[[ "$#" == 0 ]] || { print -u2 'GitPulse installer accepts no arguments; destination is /Applications/GitPulse.app.'; exit 1; }
script_dir="${0:A:h}"
candidate="$script_dir/Bitbucket PR Approver.app"
helper="$candidate/Contents/Resources/update-app.sh"
[[ -f "$helper" && ! -L "$candidate" ]] || { print -u2 'Extract the complete release ZIP before running this installer.'; exit 1; }
# Check metadata and signature before executing any code from the downloaded bundle.
[[ -f "$script_dir/GitPulse-version.txt" && ! -L "$script_dir/GitPulse-version.txt" ]] || { print -u2 'Missing release version file.'; exit 1; }
version="$(< "$script_dir/GitPulse-version.txt")"
[[ "$version" == <->.<->.<-> && "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$candidate/Contents/Info.plist")" == "$version" ]] || { print -u2 'Bundle version mismatch.'; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$candidate/Contents/Info.plist")" == 'com.hungnv.bitbucket-pr-approver.mac' ]] || { print -u2 'Bundle identity mismatch.'; exit 1; }
/usr/bin/codesign --verify --deep --strict "$candidate"
source "$helper"
gp_install_bundle "$candidate" '/Applications/GitPulse.app' "$version"
print 'Installed /Applications/GitPulse.app. Open it from Applications. Existing HOME apps and settings were not changed.'
