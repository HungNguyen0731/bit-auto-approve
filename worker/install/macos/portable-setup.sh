#!/bin/zsh
set -euo pipefail

if [[ "$(uname -s)" != Darwin ]]; then
  echo "This launcher must be set up on a Mac." >&2
  exit 1
fi
if [[ "$(id -u)" -eq 0 ]]; then
  echo "Do not run this setup as root or with sudo. Exit the root shell and run it as the Mac user who will open the browser and Terminal." >&2
  exit 1
fi

control_plane="${1:-}"
if [[ "$control_plane" != https://* || "$control_plane" == https://*/* || "$control_plane" == *'@'* || "$control_plane" == *'?'* || "$control_plane" == *'#'* ]]; then
  echo "Pass the exact HTTPS Control Plane origin, for example https://approver.example.com" >&2
  exit 1
fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "Apple Command Line Tools are required to build the Keychain helper. Install them with xcode-select --install, then retry." >&2
  exit 1
fi

stage="$(mktemp -d "${TMPDIR:-/tmp}/bitbucket-worker.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
base="$control_plane/api/worker-installer/bootstrap"
for resource in launcher terminal applescript bundle keychain-source; do
  /usr/bin/curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$base/$resource" -o "$stage/$resource"
done
/bin/mv "$stage/keychain-source" "$stage/keychain-helper.swift"

node_version=24.14.0
case "$(uname -m)" in
  arm64) node_arch=arm64 ;;
  x86_64) node_arch=x64 ;;
  *) echo "Unsupported Mac architecture" >&2; exit 1 ;;
esac
node_archive="node-v${node_version}-darwin-${node_arch}.tar.gz"
node_base="https://nodejs.org/dist/v${node_version}"
/usr/bin/curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$node_base/$node_archive" -o "$stage/$node_archive"
/usr/bin/curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$node_base/SHASUMS256.txt" -o "$stage/SHASUMS256.txt"
expected="$(/usr/bin/awk -v file="$node_archive" '$2 == file { print $1 }' "$stage/SHASUMS256.txt")"
if [[ -z "$expected" || "$(/usr/bin/shasum -a 256 "$stage/$node_archive" | /usr/bin/awk '{ print $1 }')" != "$expected" ]]; then
  echo "Node runtime checksum verification failed." >&2
  exit 1
fi
/usr/bin/tar -xzf "$stage/$node_archive" -C "$stage" "node-v${node_version}-darwin-${node_arch}/bin/node"

app="$stage/Bitbucket PR Worker Portable.app"
installed_app="$HOME/Applications/Bitbucket PR Worker Portable.app"
resources="$app/Contents/Resources"
/bin/mkdir -p "$HOME/Applications" "$HOME/Library/Application Support/BitbucketPRWorker"
/bin/chmod 700 "$HOME/Library/Application Support/BitbucketPRWorker"
/usr/bin/osacompile -o "$app" "$stage/applescript"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string com.hungnv.bitbucket-pr-worker.portable' "$app/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.hungnv.bitbucket-pr-worker.portable' "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes array' "$app/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0 dict' "$app/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array' "$app/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string bitbucket-pr-worker-portable' "$app/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c 'Set :CFBundleURLTypes:0:CFBundleURLSchemes:0 bitbucket-pr-worker-portable' "$app/Contents/Info.plist"
/bin/mkdir -p "$app/Contents/MacOS" "$resources"
/bin/cp "$stage/launcher" "$app/Contents/MacOS/WorkerLauncher"
/bin/cp "$stage/terminal" "$resources/Run Worker.command"
/bin/cp "$stage/bundle" "$resources/worker-bundle.mjs"
/bin/cp "$stage/node-v${node_version}-darwin-${node_arch}/bin/node" "$resources/node"
/usr/bin/printf '%s' "$control_plane" > "$resources/control-plane-origin"
/usr/bin/printf '%s' '2' > "$resources/control-plane-protocol"
/usr/bin/swiftc "$stage/keychain-helper.swift" -o "$resources/keychain-helper"
/bin/chmod 755 "$app/Contents/MacOS/WorkerLauncher" "$resources/Run Worker.command" "$resources/node" "$resources/keychain-helper"
/usr/bin/codesign --force --deep --sign - "$app"
backup=""
if [[ -e "$installed_app" ]]; then
  backup="$HOME/Applications/Bitbucket PR Worker Portable.backup.$(/bin/date +%s).app"
  /bin/mv "$installed_app" "$backup"
fi
if ! /bin/mv "$app" "$installed_app"; then
  if [[ -n "$backup" ]]; then /bin/mv "$backup" "$installed_app"; fi
  exit 1
fi
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$installed_app"
echo "Mac launcher ready. Return to Local Workers on $control_plane and click Run in Terminal."
if [[ -n "$backup" ]]; then echo "Previous launcher saved at: $backup"; fi
