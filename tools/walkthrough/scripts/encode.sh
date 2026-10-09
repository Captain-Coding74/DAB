#!/usr/bin/env bash
# encode.sh FRAMES_DIR OUT_DIR [VP9_CRF=36] [X264_CRF=24] [VP9_TUNE_CONTENT=]
# A copy of tools/hero-bg/scripts/encode.sh for the walkthrough (the hero's script is untouched).
# Needs an ffmpeg with libvpx-vp9 and libx264 (FFMPEG=/path/to/ffmpeg to override); Playwright's bundled ffmpeg is
# VP8-only. Writes dab-walk.webm (VP9, two-pass), dab-walk.mp4 (H.264, Safari's <source>), dab-walk-poster.jpg
# (frame 0, the <video> poster) and dab-walk-still.jpg (t = 16.8 s, the reduced-motion / Save-Data still).
set -euo pipefail
FF=${FFMPEG:-ffmpeg}
IN=$(cd "$1" && pwd); mkdir -p "$2"; OUT=$(cd "$2" && pwd)
# CRFs from the scripts/textcheck.py sweep (VP9 32/34/36, x264 22/24/26): the highest that passes. VP9 36 passes
# (1.33 MB shipped); x264 26 bleeds chroma past the 4:2:0 floor on two move frames, so H.264 stays at 24 (1.73 MB).
# -tune-content screen is a no-op with -deadline good here (identical size), so it is off by default.
VCRF=${3:-36}; XCRF=${4:-24}; TUNE=${5:-}
NFRAMES=690                              # 23 s x 30 fps (schedule.js PERIOD x FPS)
STILL_F=0504                             # renderAt(16.8): 16.8 s x 30 fps = frame 504 exactly, so the still IS that frame
n=$(find "$IN" -maxdepth 1 -name 'f[0-9][0-9][0-9][0-9].png' | wc -l)
[ "$n" -eq "$NFRAMES" ] || { echo "encode.sh: expected $NFRAMES frames in $IN, found $n" >&2; exit 1; }
encoders=$("$FF" -hide_banner -encoders 2>/dev/null)
for enc in libvpx-vp9 libx264; do grep -q " $enc " <<<"$encoders" || { echo "encode.sh: $FF lacks $enc" >&2; exit 1; }; done
cd "$OUT"
# keyframes at 0, 300 and 570: frame 0 is a keyframe, so the loop restarts cleanly. A keyframe refreshes the coding
# noise on every edge, which a static hold shows as a faint shimmer, so the others sit on camera moves: 300 (10.0 s,
# S3→S4) and 570 (19.0 s, S5→S6) instead of -g 300's 600 (20.0 s, the static chart hold). -g 300 stays the maximum.
KEYS="expr:eq(n,0)+eq(n,300)+eq(n,570)"
common=(-loglevel error -y -framerate 30 -i "$IN/f%04d.png" -pix_fmt yuv420p -g 300 -force_key_frames "$KEYS" -an)
vp9=(-c:v libvpx-vp9 -b:v 0 -crf "$VCRF" -row-mt 1 -tile-columns 1 -deadline good -cpu-used 1 -auto-alt-ref 1 -lag-in-frames 25)
[ -n "$TUNE" ] && vp9+=(-tune-content "$TUNE")
"$FF" "${common[@]}" "${vp9[@]}" -pass 1 -passlogfile vp9 -f null /dev/null
# +bitexact drops the Matroska DateUTC, so re-encoding the same frames gives a byte-identical file (no needless diff)
"$FF" "${common[@]}" "${vp9[@]}" -pass 2 -passlogfile vp9 -fflags +bitexact dab-walk.webm
"$FF" "${common[@]}" -c:v libx264 -preset veryslow -tune animation -crf "$XCRF" -profile:v high -level 4.1 -movflags +faststart dab-walk.mp4
# poster at -q:v 4: -q:v 3 is 113 KB, over the 110 KB budget; 4 is ~95 KB and indistinguishable at 100 %
"$FF" -loglevel error -y -i "$IN/f0000.png" -vf scale=1600:-2 -q:v 4 dab-walk-poster.jpg
"$FF" -loglevel error -y -i "$IN/f$STILL_F.png" -vf scale=1600:-2 -q:v 3 dab-walk-still.jpg
rm -f vp9-0.log
ls -l dab-walk.webm dab-walk.mp4 dab-walk-poster.jpg dab-walk-still.jpg
