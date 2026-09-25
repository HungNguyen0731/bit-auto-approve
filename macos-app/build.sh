#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
app="$script_dir/dist/Bitbucket PR Approver.app"
/bin/mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
/bin/cp "$script_dir/Info.plist" "$app/Contents/Info.plist"
/usr/bin/swiftc -parse-as-library -framework SwiftUI -framework AppKit \
  "$script_dir/BitbucketPRApprover.swift" -o "$app/Contents/MacOS/BitbucketPRApprover"
/bin/cp "$script_dir/../worker/install/macos/portable-setup.sh" "$app/Contents/Resources/portable-setup.sh"
/bin/chmod 755 "$app/Contents/MacOS/BitbucketPRApprover" "$app/Contents/Resources/portable-setup.sh"
/usr/bin/codesign --force --deep --sign - "$app"
echo "Built $app"
