#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
app="$script_dir/dist/Bitbucket PR Approver.app"
/bin/mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
/bin/zsh "$script_dir/build-icon.sh"
/bin/cp "$script_dir/Info.plist" "$app/Contents/Info.plist"
/bin/cp "$script_dir/dist/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
/bin/cp "$script_dir/dist/AppIcon.iconset/icon_256x256.png" "$app/Contents/Resources/app-logo.png"
/bin/cp "$script_dir/Assets/pr-workflow.png" "$app/Contents/Resources/pr-workflow.png"
/usr/bin/swiftc -parse-as-library -framework SwiftUI -framework AppKit \
  "$script_dir/BitbucketPRApprover.swift" -o "$app/Contents/MacOS/BitbucketPRApprover"
/bin/cp "$script_dir/../worker/install/macos/portable-setup.sh" "$app/Contents/Resources/portable-setup.sh"
/bin/chmod 755 "$app/Contents/MacOS/BitbucketPRApprover" "$app/Contents/Resources/portable-setup.sh"
/usr/bin/codesign --force --deep --sign - "$app"
echo "Built $app"
