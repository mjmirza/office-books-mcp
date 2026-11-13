#!/usr/bin/env bash
# Frames a raw screenshot like the hetzner-mcp setup guide: red highlight, numbered marker, blur, rounded corners, shadow.
# Usage: annotate-shot.sh IN OUT CROP_H "x,y,w,h;..." "x,y,w,h;..." BADGE   (rects in image pixels, blur list may be "")
set -euo pipefail

in="$1" out="$2" crop_h="$3" highlights="$4" blurs="$5" badge="${6:-}"
red="#E5243B"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

w="$(magick identify -format '%w' "$in")"
magick "$in" -crop "${w}x${crop_h}+0+0" +repage "$tmp/base.png"

# Blur every personal-data region a second time, even when the page already blurred it.
IFS=';' read -ra B <<<"$blurs"
for r in "${B[@]}"; do
  [ -z "$r" ] && continue
  IFS=',' read -r x y bw bh <<<"$r"
  magick "$tmp/base.png" \( +clone -crop "${bw}x${bh}+${x}+${y}" +repage -blur 0x14 \) -geometry "+${x}+${y}" -composite "$tmp/base.png"
done

draw=()
IFS=';' read -ra H <<<"$highlights"
first=""
for r in "${H[@]}"; do
  [ -z "$r" ] && continue
  IFS=',' read -r x y hw hh <<<"$r"
  pad=10
  x0=$((x - pad)) y0=$((y - pad)) x1=$((x + hw + pad)) y1=$((y + hh + pad))
  draw+=(-fill none -stroke "$red" -strokewidth 6 -draw "roundrectangle $x0,$y0 $x1,$y1 14,14")
  [ -z "$first" ] && first="$x0,$y0"
done
magick "$tmp/base.png" "${draw[@]}" "$tmp/marked.png"

if [ -n "$badge" ] && [ -n "$first" ]; then
  IFS=',' read -r bx by <<<"$first"
  cx=$((bx < 30 ? 30 : bx)) cy=$((by < 30 ? 30 : by))
  magick "$tmp/marked.png" -fill "$red" -stroke white -strokewidth 4 -draw "circle $cx,$cy $((cx + 26)),$cy" \
    -fill white -stroke none -font "${BADGE_FONT:-/System/Library/Fonts/Supplemental/Arial Bold.ttf}" -pointsize 30 -gravity NorthWest -annotate "+$((cx - 9))+$((cy - 18))" "$badge" "$tmp/marked.png"
fi

# Rounded corners, then a soft drop shadow on a white canvas.
mw="$(magick identify -format '%w' "$tmp/marked.png")" mh="$(magick identify -format '%h' "$tmp/marked.png")"
magick -size "${mw}x${mh}" xc:none -fill white -draw "roundrectangle 0,0 $((mw - 1)),$((mh - 1)) 28,28" "$tmp/mask.png"
magick "$tmp/marked.png" "$tmp/mask.png" -alpha off -compose CopyOpacity -composite "$tmp/rounded.png"
magick "$tmp/rounded.png" \( +clone -background black -shadow 45x22+0+14 \) +swap -background white -layers merge +repage \
  -bordercolor white -border 24 -resize '1600x>' "$out"
