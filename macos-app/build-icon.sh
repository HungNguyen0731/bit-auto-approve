#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
source_svg="$script_dir/Assets/app-logo.svg"
iconset="$script_dir/dist/AppIcon.iconset"
/bin/mkdir -p "$iconset"
renderer="$(command -v rsvg-convert)"
[[ -n "$renderer" ]] || { print -u2 'rsvg-convert is required to build the app icon.'; exit 1; }

for size name in \
  16 icon_16x16.png \
  32 icon_16x16@2x.png \
  32 icon_32x32.png \
  64 icon_32x32@2x.png \
  128 icon_128x128.png \
  256 icon_128x128@2x.png \
  256 icon_256x256.png \
  512 icon_256x256@2x.png \
  512 icon_512x512.png \
  1024 icon_512x512@2x.png; do
  "$renderer" -w "$size" -h "$size" "$source_svg" -o "$iconset/$name"
done
/usr/bin/iconutil -c icns "$iconset" -o "$script_dir/dist/AppIcon.icns"
