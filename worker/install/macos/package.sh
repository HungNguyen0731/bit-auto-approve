#!/bin/zsh
set -euo pipefail
export COPYFILE_DISABLE=1

worker_root="$(cd "$(dirname "$0")/../.." && pwd)"
package_root="$(cd "$worker_root/.." && pwd)"
output_dir="$worker_root/dist-packages"
stage_dir="$(mktemp -d)"
scripts_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir" "$scripts_dir"' EXIT

cd "$worker_root"
npm run build

app_dir="$stage_dir/Applications/Bitbucket PR Worker.app"
contents_dir="$app_dir/Contents"
resources_dir="$contents_dir/Resources"
mkdir -p "$contents_dir/MacOS" "$resources_dir" "$output_dir"

cp -X "$worker_root/install/macos/Info.plist" "$contents_dir/Info.plist"
cp -X "$worker_root/install/macos/WorkerLauncher" "$contents_dir/MacOS/WorkerLauncher"
cp -X "$(command -v node)" "$resources_dir/node"
cp -X "$worker_root/dist/worker-bundle.mjs" "$resources_dir/worker-bundle.mjs"
cp -X "$worker_root/native/keychain-helper" "$resources_dir/keychain-helper"
cp -X "$worker_root/install/macos/com.hungnv.bitbucket-pr-worker.plist.template" "$resources_dir/"
cp -X "$worker_root/install/macos/postinstall" "$scripts_dir/postinstall"
chmod 755 "$contents_dir/MacOS/WorkerLauncher" "$resources_dir/node" "$resources_dir/keychain-helper" "$scripts_dir/postinstall"
/usr/bin/xattr -cr "$stage_dir"
/usr/sbin/dot_clean -m "$stage_dir"
/usr/bin/find "$stage_dir" -name '._*' -type f -delete

unsigned_package="$output_dir/BitbucketPRWorker-0.1.0-dev.pkg"
pkgbuild --root "$stage_dir" \
  --scripts "$scripts_dir" \
  --identifier com.hungnv.bitbucket-pr-worker \
  --version 0.1.0 \
  --install-location / \
  "$unsigned_package"

if [[ -n "${PKG_SIGN_IDENTITY:-}" ]]; then
  productsign --sign "$PKG_SIGN_IDENTITY" "$unsigned_package" \
    "$output_dir/BitbucketPRWorker-0.1.0.pkg"
fi

echo "$unsigned_package"
