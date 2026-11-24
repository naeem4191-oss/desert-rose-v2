#!/bin/zsh
# Builds the scroll-scrubbed museum clips from the stock master.
#   tools/museum_cut.sh "<folder with shutterstock_4246022675.mp4>"
# Source: 4.04 s, 24 fps day → night timelapse of the National Museum of Qatar with a slow pull-back,
# pillarboxed 1620×1080 inside 1920×1080. Used whole and ungraded; only the bars are cropped off.
# (The earlier two-shot drone edit lives in this script's git history.)
# Outputs, each as AV1 (*_av1.mp4, ~40% smaller at equal quality) and an H.264 fallback:
#   museum_scrub*     1280×854 for desktop (cover-fitted, so the 3:2 frame loses a little top/bottom)
#   museum_scrub_m*   720×1280 for phones: a 1010-px-wide window on the central building fills the top 60%
#                     and fades to black below, so the museum sits above the bottom-anchored card and its scrim
# Keyframe every 12 frames so a seek never decodes far.
set -e
SRC=${1:-$HOME/Downloads/Desert rose videos}/shutterstock_4246022675.mp4
OUT=${0:A:h}/../assets

H264=(-an -c:v libx264 -preset veryslow -tune film -profile:v high -pix_fmt yuv420p -g 12 -keyint_min 12 -bf 2 -sc_threshold 0 -crf 27 -movflags +faststart)
AV1=(-an -c:v libsvtav1 -preset 3 -pix_fmt yuv420p10le -svtav1-params tune=0:enable-overlays=1 -g 12 -movflags +faststart)
enc() { ffmpeg -v error -y -i "$SRC" -vf "$1" "${H264[@]}" "$OUT/$2.mp4"; ffmpeg -v error -y -i "$SRC" -vf "$1" "${AV1[@]}" -crf $3 "$OUT/$2_av1.mp4" 2>/dev/null; }

# a few px inside the 150-px bars so no dark edge survives scaling
enc "crop=1612:1076:154:2,scale=1280:854:flags=lanczos" museum_scrub 42
# portrait: window centred on the main building (x ≈ 1000 in the 1920 frame), faded out over 53–60% of the height
F="clip((0.6-Y/H)/0.07,0,1)"
enc "crop=1010:1076:495:2,scale=720:768:flags=lanczos,pad=720:1280:0:0:black,format=gbrp,geq=r='r(X,Y)*$F':g='g(X,Y)*$F':b='b(X,Y)*$F'" museum_scrub_m 44

ls -l "$OUT"/museum_scrub*.mp4
